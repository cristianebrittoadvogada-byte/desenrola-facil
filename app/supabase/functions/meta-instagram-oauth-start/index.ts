import { createClient } from "@supabase/supabase-js";
import { buildInstagramAuthorizationUrl, sha256Hex } from "../meta-instagram/logic.mjs";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const PANEL_ORIGINS = new Set([
  "https://desenrola-facil-painel-72oq.onrender.com",
  "https://desenrola-facil-painel.onrender.com",
  "http://localhost:3000",
  "http://127.0.0.1:3000",
]);

function json(body: unknown, status = 200, origin = "") {
  const headers = new Headers({ "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", Vary: "Origin" });
  if (PANEL_ORIGINS.has(origin)) {
    headers.set("Access-Control-Allow-Origin", origin);
    headers.set("Access-Control-Allow-Headers", "authorization, apikey, content-type");
    headers.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  }
  return new Response(JSON.stringify(body), { status, headers });
}

function stateValue(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

Deno.serve(async (request: Request) => {
  const origin = request.headers.get("Origin") ?? "";
  if (request.method === "OPTIONS") return json({}, 204, origin);
  if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405, origin);
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_ROLE_KEY) return json({ error: "oauth_service_not_configured" }, 503, origin);

  const authorization = request.headers.get("Authorization");
  if (!authorization?.startsWith("Bearer ")) return json({ error: "authentication_required" }, 401, origin);
  const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authorization } }, auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: authData, error: authError } = await userClient.auth.getUser();
  if (authError || !authData.user) return json({ error: "invalid_session" }, 401, origin);
  const { data: roles, error: roleError } = await userClient.from("user_roles").select("role").eq("user_id", authData.user.id);
  if (roleError) return json({ error: "role_check_failed" }, 403, origin);
  if (!(roles ?? []).some((row) => ["owner", "admin"].includes(row.role))) return json({ error: "administrator_required" }, 403, origin);

  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: settings, error: settingsError } = await admin.from("integration_settings")
    .select("public_config,secret_reference,status").eq("provider", "instagram_graph").maybeSingle();
  if (settingsError) return json({ error: "integration_settings_unavailable" }, 503, origin);
  const appId = String(settings?.public_config?.app_id ?? "");
  if (!/^\d{5,32}$/.test(appId) || !settings?.secret_reference) return json({ error: "meta_app_setup_required" }, 409, origin);

  const stateBytes = crypto.getRandomValues(new Uint8Array(32));
  const state = stateValue(stateBytes);
  const stateHash = await sha256Hex(state);
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
  const { error: stateError } = await admin.from("meta_oauth_states").insert({
    state_hash: stateHash, provider: "instagram_graph", initiated_by: authData.user.id, expires_at: expiresAt,
  });
  if (stateError) return json({ error: "oauth_state_creation_failed" }, 503, origin);

  const callbackUrl = `${SUPABASE_URL.replace(/\/+$/, "")}/functions/v1/meta-instagram-oauth-callback`;
  let authorizationUrl: string;
  try {
    authorizationUrl = buildInstagramAuthorizationUrl({ appId, redirectUri: callbackUrl, state });
  } catch {
    return json({ error: "oauth_configuration_invalid" }, 503, origin);
  }
  return json({ authorization_url: authorizationUrl, callback_url: callbackUrl, state_expires_in: 600 }, 200, origin);
});
