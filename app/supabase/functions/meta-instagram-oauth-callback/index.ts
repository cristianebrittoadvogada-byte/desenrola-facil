import { createClient } from "@supabase/supabase-js";
import { INSTAGRAM_OAUTH_SCOPES, exchangeInstagramCode, getAssignedInstagramAccounts, getInstagramClientBusinessId, isExpectedInstagramAccount, sha256Hex } from "../meta-instagram/logic.mjs";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const PANEL_URL = "https://desenrola-facil-painel-72oq.onrender.com/";
const GRAPH_VERSION = Deno.env.get("META_GRAPH_VERSION") ?? "v27.0";

function redirectResult(result: string, code = "") {
  const url = new URL(PANEL_URL);
  url.searchParams.set("meta_instagram", result);
  if (code) url.searchParams.set("code", code);
  return Response.redirect(url.toString(), 303);
}

async function readSecret(admin: ReturnType<typeof createClient>, secretId: string) {
  const { data, error } = await admin.rpc("meta_instagram_secret_read", { p_secret_id: secretId });
  if (error || typeof data !== "string") throw new Error("secret_unavailable");
  let secret: Record<string, unknown>;
  try { secret = JSON.parse(data); } catch { throw new Error("secret_unavailable"); }
  return secret;
}

async function storeSecret(admin: ReturnType<typeof createClient>, secretId: string, secret: Record<string, unknown>) {
  const { data, error } = await admin.rpc("meta_instagram_secret_store", {
    p_secret: JSON.stringify(secret), p_secret_id: secretId,
  });
  if (error || String(data) !== secretId) throw new Error("secret_store_failed");
}

Deno.serve(async (request: Request) => {
  if (request.method !== "GET") return new Response("Method not allowed", { status: 405 });
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return redirectResult("error", "oauth_unavailable");
  const url = new URL(request.url);
  const state = url.searchParams.get("state") ?? "";
  if (state.length < 32 || state.length > 256) return redirectResult("error", "invalid_state");

  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const stateHash = await sha256Hex(state);
  const now = new Date().toISOString();
  const { data: consumed, error: consumeError } = await admin.from("meta_oauth_states")
    .update({ consumed_at: now }).eq("state_hash", stateHash).eq("provider", "instagram_graph")
    .is("consumed_at", null).gt("expires_at", now).select("initiated_by").maybeSingle();
  if (consumeError || !consumed) return redirectResult("error", "state_expired_or_used");
  if (url.searchParams.has("error")) return redirectResult("error", "authorization_denied");
  const code = url.searchParams.get("code") ?? "";
  if (!code || code.length > 4096) return redirectResult("error", "authorization_code_missing");

  try {
    const { data: settings, error: settingsError } = await admin.from("integration_settings")
      .select("public_config,secret_reference").eq("provider", "instagram_graph").maybeSingle();
    if (settingsError || !settings?.secret_reference) throw new Error("app_setup_required");
    const appId = String(settings.public_config?.app_id ?? "");
    if (!/^\d{5,32}$/.test(appId)) throw new Error("app_setup_required");
    const secretId = String(settings.secret_reference);
    const stored = await readSecret(admin, secretId);
    if (stored.app_id !== appId || typeof stored.app_secret !== "string" || stored.app_secret.length < 8) throw new Error("app_setup_required");

    const configId = String(settings.public_config?.config_id ?? "");
    if (!/^\d{8,32}$/.test(configId)) throw new Error("app_setup_required");
    const callbackUrl = `${SUPABASE_URL.replace(/\/+$/, "")}/functions/v1/meta-instagram-oauth-callback`;
    const token = await exchangeInstagramCode({ appId, appSecret: stored.app_secret, code, graphVersion: GRAPH_VERSION });
    const accessToken = token.access_token;
    const business = await getInstagramClientBusinessId({ accessToken, graphVersion: GRAPH_VERSION });
    const accounts = await getAssignedInstagramAccounts({ accessToken, graphVersion: GRAPH_VERSION });
    const identity = accounts.find(isExpectedInstagramAccount);
    if (!identity) throw new Error("wrong_instagram_account");

    const obtainedAt = new Date();
    const expiresIn = Number(token.expires_in);
    const expiresAt = Number.isFinite(expiresIn) && expiresIn > 0
      ? new Date(obtainedAt.getTime() + expiresIn * 1000).toISOString()
      : null;
    const permissions = [...INSTAGRAM_OAUTH_SCOPES];
    await storeSecret(admin, secretId, {
      ...stored,
      auth_flow: "instagram_unified_login",
      token_type: "business_integration_system_user",
      access_token: accessToken,
      token_obtained_at: obtainedAt.toISOString(),
      token_expires_at: expiresAt,
      client_business_id: business.clientBusinessId,
      account_id: identity.id,
      username: identity.username,
      config_id: configId,
      granted_permissions: permissions,
    });
    const publicConfig = {
      ...(settings.public_config ?? {}),
      auth_flow: "instagram_unified_login",
      account_id: identity.id,
      username: identity.username,
      configured_permissions: permissions,
      client_business_id: business.clientBusinessId,
      config_id: configId,
      token_expires_at: expiresAt,
      callback_url: callbackUrl,
      connected_at: obtainedAt.toISOString(),
    };
    const { error: saveError } = await admin.from("integration_settings").upsert({
      provider: "instagram_graph", status: "configured", public_config: publicConfig,
      secret_reference: secretId, updated_by: consumed.initiated_by,
    }, { onConflict: "provider" });
    if (saveError) throw new Error("connection_metadata_save_failed");
    return redirectResult("connected");
  } catch (error) {
    const code = error instanceof Error && /^[a-z0-9_]{1,64}$/.test(error.message) ? error.message : "oauth_exchange_failed";
    return redirectResult("error", code);
  }
});

