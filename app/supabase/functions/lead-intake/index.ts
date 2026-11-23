import { createClient } from "@supabase/supabase-js";
import { isAllowedOrigin, responseBody, validateLeadPayload } from "./validation.mjs";

const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const db = supabaseUrl && serviceRoleKey
  ? createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } })
  : null;
const requestBuckets = new Map<string, { count: number; resetAt: number }>();
const RATE_WINDOW_MS = 15 * 60 * 1000;
const RATE_LIMIT = 8;

function response(body: unknown, status: number, origin: string | null) {
  const headers = new Headers({
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Vary": "Origin",
  });
  if (origin && isAllowedOrigin(origin)) {
    headers.set("Access-Control-Allow-Origin", origin);
    headers.set("Access-Control-Allow-Methods", "POST, OPTIONS");
    headers.set("Access-Control-Allow-Headers", "apikey, content-type, x-client-info");
    headers.set("Access-Control-Max-Age", "600");
  }
  return new Response(responseBody(body, status), { status, headers });
}

async function requestKey(request: Request) {
  // The gateway supplies X-Forwarded-For. Keep only an in-memory hash; never log
  // or persist the raw address. This is a best-effort abuse limit per isolate.
  const forwarded = request.headers.get("x-forwarded-for") ?? "";
  const address = forwarded.split(",").map((part) => part.trim()).filter(Boolean).at(-1)
    ?? request.headers.get("x-real-ip")?.trim()
    ?? "unknown";
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(address));
  return [...new Uint8Array(bytes)].map((value) => value.toString(16).padStart(2, "0")).join("");
}

function consumeRateLimit(key: string, now = Date.now()) {
  if (requestBuckets.size > 10_000) {
    for (const [bucketKey, bucket] of requestBuckets) if (bucket.resetAt <= now) requestBuckets.delete(bucketKey);
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

Deno.serve(async (request: Request) => {
  const origin = request.headers.get("origin");
  if (!isAllowedOrigin(origin)) return response({ error: "origin_not_allowed" }, 403, null);
  if (request.method === "OPTIONS") return response({ ok: true }, 204, origin);
  if (request.method !== "POST") return response({ error: "method_not_allowed" }, 405, origin);
  if (!db) return response({ error: "intake_unavailable" }, 503, origin);

  const declaredLength = Number(request.headers.get("content-length") ?? 0);
  if (declaredLength > 8192) return response({ error: "request_too_large" }, 413, origin);
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    return response({ error: "json_required" }, 415, origin);
  }

  const key = await requestKey(request);
  if (!consumeRateLimit(key)) return response({ error: "rate_limited" }, 429, origin);

  let payload: unknown;
  try {
    const raw = await request.text();
    if (new TextEncoder().encode(raw).byteLength > 8192) return response({ error: "request_too_large" }, 413, origin);
    payload = JSON.parse(raw);
  } catch {
    return response({ error: "invalid_json" }, 400, origin);
  }

  const validated = validateLeadPayload(payload);
  if (!validated.ok) {
    if (validated.code === "honeypot") return response({ accepted: true }, 202, origin);
    return response({ error: validated.code }, validated.code === "contact_consent_required" ? 403 : 400, origin);
  }

  const { value } = validated;
  const { data, error } = await db.rpc("capture_public_mentoria_lead", {
    p_request_id: value.requestId,
    p_name: value.name,
    p_phone: value.phone,
    p_email: value.email,
    p_source: value.source,
    p_contact_consent: value.consent,
  });
  if (error || data?.accepted !== true) return response({ error: "lead_save_failed" }, 503, origin);
  return response({ accepted: true }, 200, origin);
});
