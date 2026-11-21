import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "@supabase/supabase-js";
import { isFirstOwnerIdentityAllowed, normalizeOwnerProfile } from "./logic.mjs";

const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const allowedOrigins = new Set([
  ...(Deno.env.get("WEB_ORIGIN") ?? "").split(",").map((origin) => origin.trim()).filter(Boolean),
  "http://localhost:3000",
  "http://127.0.0.1:3000",
  "https://desenrola-facil-painel.onrender.com",
  "https://desenrola-facil-painel-72oq.onrender.com",
]);

function respond(body: unknown, status: number, origin = "") {
  const headers = new Headers({
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Vary": "Origin",
  });
  if (origin && allowedOrigins.has(origin)) {
    headers.set("Access-Control-Allow-Origin", origin);
    headers.set("Access-Control-Allow-Headers", "authorization, apikey, content-type");
    headers.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  }
  return new Response(status === 204 ? null : JSON.stringify(body), { status, headers });
}

Deno.serve(async (request) => {
  const origin = request.headers.get("Origin") ?? "";
  if (request.method === "OPTIONS") return respond({}, 204, origin);
  if (request.method !== "POST") return respond({ error: "method_not_allowed" }, 405, origin);
  if (!supabaseUrl || !anonKey || !serviceKey) return respond({ error: "bootstrap_unavailable" }, 503, origin);

  const authorization = request.headers.get("Authorization");
  if (!authorization?.startsWith("Bearer ")) return respond({ error: "authentication_required" }, 401, origin);

  const userDb = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: authData, error: authError } = await userDb.auth.getUser();
  const user = authData?.user;
  if (authError || !user || !isFirstOwnerIdentityAllowed(user)) {
    return respond({ error: "bootstrap_identity_not_authorized" }, 403, origin);
  }

  let raw: string;
  try {
    raw = await request.text();
    if (new TextEncoder().encode(raw).byteLength > 2048) return respond({ error: "request_too_large" }, 413, origin);
  } catch {
    return respond({ error: "invalid_request" }, 400, origin);
  }

  let input: unknown;
  try {
    input = JSON.parse(raw);
  } catch {
    return respond({ error: "invalid_request" }, 400, origin);
  }
  const profile = normalizeOwnerProfile(input as Record<string, unknown>);
  if (profile.error) return respond({ error: profile.error }, 422, origin);

  const serviceDb = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error } = await serviceDb.rpc("bootstrap_first_company_owner", {
    p_user_id: user.id,
    p_email: user.email,
    p_full_name: profile.full_name,
  });
  if (error) return respond({ error: "owner_bootstrap_denied" }, 403, origin);
  return respond({ data: { role: "owner", status: "provisioned" } }, 200, origin);
});
