import { createClient } from "@supabase/supabase-js";
import { DEFAULT_CLOUDFLARE_MODEL, normalizeSiteChatMessages, hasCloudflareAiConfig, isAllowedSiteChatOrigin, redactSiteChatText, requiresSiteChatEscalation } from "./logic.mjs";
import { buildSiteSalesInstructions } from "./prompt.mjs";

const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const cloudflareAccountId = Deno.env.get("CLOUDFLARE_ACCOUNT_ID") ?? "";
const cloudflareApiToken = Deno.env.get("CLOUDFLARE_API_TOKEN") ?? "";
const cloudflareModel = DEFAULT_CLOUDFLARE_MODEL;
const database = supabaseUrl && serviceRoleKey
  ? createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } })
  : null;
const credentialsConfigured = hasCloudflareAiConfig({ accountId: cloudflareAccountId, apiToken: cloudflareApiToken }) && Boolean(database);

const requestBuckets = new Map<string, { count: number; resetAt: number }>();
const RATE_WINDOW_MS = 10 * 60 * 1000;
const RATE_LIMIT = 10;

function json(body: unknown, status = 200, origin: string | null = null) {
  const headers = new Headers({
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Vary": "Origin",
  });
  if (origin && isAllowedSiteChatOrigin(origin)) {
    headers.set("Access-Control-Allow-Origin", origin);
    headers.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    headers.set("Access-Control-Allow-Headers", "apikey, content-type, x-client-info");
    headers.set("Access-Control-Max-Age", "600");
  }
  return new Response(JSON.stringify(body), { status, headers });
}

async function rateLimitKey(request: Request) {
  const forwarded = request.headers.get("x-forwarded-for") ?? "";
  const address = forwarded.split(",").map((part) => part.trim()).filter(Boolean).at(-1)
    ?? request.headers.get("x-real-ip")?.trim()
    ?? "unknown";
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(address)));
  return [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function consumeRateLimit(key: string, now = Date.now()) {
  if (requestBuckets.size > 10_000) {
    for (const [bucketKey, bucket] of requestBuckets) if (bucket.resetAt <= now) requestBuckets.delete(bucketKey);
    while (requestBuckets.size > 10_000) {
      const oldestKey = requestBuckets.keys().next().value;
      if (!oldestKey) break;
      requestBuckets.delete(oldestKey);
    }
  }
  const current = requestBuckets.get(key);
  if (!current || current.resetAt <= now) {
    requestBuckets.set(key, { count: 1, resetAt: now + RATE_WINDOW_MS });
    return true;
  }
  if (current.count >= RATE_LIMIT) return false;
  current.count += 1;
  return true;
}

async function hasActiveMentoriaOffer() {
  if (!database) return false;
  const { data, error } = await database.from("products")
    .select("price").eq("active", true).eq("code", "mentoria-desenrola-facil").limit(1);
  return !error && Array.isArray(data) && data.length === 1 && Number(data[0].price) === 3000;
}

Deno.serve(async (request: Request) => {
  const origin = request.headers.get("origin");
  if (!isAllowedSiteChatOrigin(origin)) return json({ error: "origin_not_allowed" }, 403);
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: {
    "Access-Control-Allow-Origin": origin!,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "apikey, content-type, x-client-info",
    "Access-Control-Max-Age": "600",
    "Vary": "Origin",
  } });
  if (request.method === "GET") return json({ available: credentialsConfigured && await hasActiveMentoriaOffer() }, 200, origin);
  if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405, origin);
  if (!credentialsConfigured) return json({ error: "site_assistant_not_configured" }, 503, origin);
  if (!database) return json({ error: "site_assistant_unavailable" }, 503, origin);

  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    return json({ error: "json_required" }, 415, origin);
  }
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (contentLength > 16_384) return json({ error: "request_too_large" }, 413, origin);

  let payload: unknown;
  try {
    const raw = await request.text();
    if (new TextEncoder().encode(raw).byteLength > 16_384) return json({ error: "request_too_large" }, 413, origin);
    payload = JSON.parse(raw);
  } catch {
    return json({ error: "invalid_json" }, 400, origin);
  }

  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return json({ error: "invalid_payload" }, 400, origin);
  const data = payload as Record<string, unknown>;
  if (data.notice_accepted !== true) return json({ error: "ai_notice_required" }, 403, origin);
  const messages = normalizeSiteChatMessages(data.messages);
  const sessionId = String(data.session_id ?? "");
  if (!messages || !/^[0-9a-f-]{36}$/i.test(sessionId)) return json({ error: "invalid_messages" }, 400, origin);
  if (!consumeRateLimit(await rateLimitKey(request))) return json({ error: "rate_limited" }, 429, origin);
  if (requiresSiteChatEscalation(messages.at(-1)?.content)) {
    return json({ reply: "Esse assunto pode exigir uma análise profissional. Não envie documentos nem detalhes pessoais por aqui. Se quiser, peça retorno da equipe pelo formulário da página.", escalated: true }, 200, origin);
  }

  const { data: offers, error: offerError } = await database!.from("products")
    .select("code,name,category,description,price,currency,format,duration_text,delivery_mode")
    .eq("active", true).eq("code", "mentoria-desenrola-facil").limit(1);
  if (offerError || !Array.isArray(offers) || offers.length !== 1 || Number(offers[0].price) !== 3000) {
    return json({ error: "offer_catalog_unavailable" }, 503, origin);
  }

  let providerResponse: Response;
  try {
    providerResponse = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${cloudflareAccountId}/ai/v1/chat/completions`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${cloudflareApiToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: cloudflareModel,
          messages: [
            { role: "system", content: buildSiteSalesInstructions(offers[0]) },
            ...messages,
          ],
          max_tokens: 260,
          temperature: 0.3,
          stream: false,
        }),
        signal: AbortSignal.timeout(10_000),
      },
    );
  } catch {
    return json({ error: "ai_provider_unreachable" }, 503, origin);
  }
  if (!providerResponse.ok) return json({ error: "ai_provider_unavailable" }, providerResponse.status === 429 ? 429 : 503, origin);

  let providerBody: unknown;
  try { providerBody = await providerResponse.json(); } catch { return json({ error: "ai_response_invalid" }, 503, origin); }
  const choices = (providerBody as { choices?: Array<{ message?: { content?: unknown } }> })?.choices;
  const reply = typeof choices?.[0]?.message?.content === "string" ? choices[0].message.content.trim() : "";
  if (!reply || reply.length > 3000) return json({ error: "ai_response_invalid" }, 503, origin);

  return json({ reply: redactSiteChatText(reply) }, 200, origin);
});
