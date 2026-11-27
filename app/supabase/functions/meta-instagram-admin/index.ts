import { createClient } from "@supabase/supabase-js";
import { getInstagramIdentity, isExpectedInstagramAccount, publishInstagramImage, refreshUnifiedLoginToken, validateInstagramImagePublication } from "../meta-instagram/logic.mjs";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const GRAPH_VERSION = Deno.env.get("META_GRAPH_VERSION") ?? "v27.0";
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
  return new Response(status === 204 ? null : JSON.stringify(body), { status, headers });
}

async function readJson(request: Request) {
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > 16_384) throw new Error("request_too_large");
  const body = JSON.parse(text);
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("invalid_request");
  return body as Record<string, unknown>;
}

function randomSecret() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function authorize(request: Request) {
  const authorization = request.headers.get("Authorization");
  if (!authorization?.startsWith("Bearer ")) throw new Error("authentication_required");
  const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authorization } }, auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: authData, error: authError } = await userClient.auth.getUser();
  if (authError || !authData.user) throw new Error("invalid_session");
  const { data: roles, error: rolesError } = await userClient.from("user_roles").select("role").eq("user_id", authData.user.id);
  if (rolesError) throw new Error("role_check_failed");
  if (!(roles ?? []).some((row) => ["owner", "admin"].includes(row.role))) throw new Error("administrator_required");
  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  return { user: authData.user, admin };
}

async function getSettings(admin: ReturnType<typeof createClient>) {
  const { data, error } = await admin.from("integration_settings")
    .select("status,public_config,secret_reference").eq("provider", "instagram_graph").maybeSingle();
  if (error) throw new Error("integration_settings_unavailable");
  return data;
}

async function readSecret(admin: ReturnType<typeof createClient>, secretId: string) {
  const { data, error } = await admin.rpc("meta_instagram_secret_read", { p_secret_id: secretId });
  if (error || typeof data !== "string") throw new Error("secret_unavailable");
  try { return JSON.parse(data) as Record<string, unknown>; } catch { throw new Error("secret_unavailable"); }
}

async function storeSecret(admin: ReturnType<typeof createClient>, secretId: string, secret: Record<string, unknown>) {
  const { data, error } = await admin.rpc("meta_instagram_secret_store", {
    p_secret: JSON.stringify(secret), p_secret_id: secretId,
  });
  if (error || String(data) !== secretId) throw new Error("secret_store_failed");
}

async function saveSettings(admin: ReturnType<typeof createClient>, userId: string, settings: Record<string, unknown>) {
  const { error } = await admin.from("integration_settings").upsert({
    provider: "instagram_graph", status: settings.status, public_config: settings.public_config,
    secret_reference: settings.secret_reference, updated_by: userId,
  }, { onConflict: "provider" });
  if (error) throw new Error("integration_settings_save_failed");
}

async function subscribeInstagramMessages({ accountId, accessToken }: { accountId: string; accessToken: string }) {
  if (!/^\d{5,32}$/.test(accountId) || accessToken.length < 20) throw new Error("instagram_credentials_invalid");
  const response = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${accountId}/subscribed_apps`, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ subscribed_fields: "messages", access_token: accessToken }),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok || payload?.error || payload?.success !== true) throw new Error("instagram_webhook_subscription_failed");
}

async function ensureUsableCredentials(admin: ReturnType<typeof createClient>, userId: string, settings: Record<string, unknown>) {
  const secretId = String(settings.secret_reference ?? "");
  if (!secretId) throw new Error("instagram_not_connected");
  const secret = await readSecret(admin, secretId);
  let accessToken = String(secret.access_token ?? "");
  const expiryValue = String(secret.token_expires_at ?? "");
  let expiresAt = expiryValue ? Date.parse(expiryValue) : Number.POSITIVE_INFINITY;
  const obtainedAt = Date.parse(String(secret.token_obtained_at ?? ""));
  if (secret.auth_flow !== "instagram_unified_login" || accessToken.length < 20 || Number.isNaN(expiresAt)) throw new Error("instagram_not_connected");
  if (expiresAt <= Date.now()) throw new Error("instagram_reconnect_required");

  const timeRemaining = expiresAt - Date.now();
  const refreshWindow = 7 * 24 * 60 * 60 * 1000;
  let refreshWarning: string | null = null;
  if (timeRemaining <= refreshWindow) {
    if (Number.isFinite(obtainedAt) && Date.now() - obtainedAt >= 24 * 60 * 60 * 1000) {
      try {
        const refreshed = await refreshUnifiedLoginToken({
          appId: String(secret.app_id ?? ""), appSecret: String(secret.app_secret ?? ""), accessToken, graphVersion: GRAPH_VERSION,
        });
        const nextSecret = {
          ...secret,
          access_token: refreshed.accessToken,
          token_obtained_at: new Date().toISOString(),
          token_expires_at: new Date(Date.now() + refreshed.expiresIn * 1000).toISOString(),
        };
        const nextSettings = {
          ...settings,
          public_config: { ...(settings.public_config as Record<string, unknown> ?? {}), token_expires_at: nextSecret.token_expires_at },
        };
        await storeSecret(admin, secretId, nextSecret);
        await saveSettings(admin, userId, nextSettings);
        secret = nextSecret;
        settings.public_config = nextSettings.public_config;
        accessToken = refreshed.accessToken;
      } catch {
        refreshWarning = "refresh_temporarily_unavailable";
      }
    } else {
      refreshWarning = "refresh_available_after_24_hours";
    }
  }

  const accountId = String(secret.account_id ?? "");
  const identity = await getInstagramIdentity({ accountId, accessToken, graphVersion: GRAPH_VERSION });
  if (!isExpectedInstagramAccount(identity) || identity.id !== String(secret.account_id ?? "")) throw new Error("instagram_identity_mismatch");
  return { accessToken, identity, expiresAt: Number.isFinite(expiresAt) ? new Date(expiresAt).toISOString() : null, refreshWarning };
}

Deno.serve(async (request: Request) => {
  const origin = request.headers.get("Origin") ?? "";
  if (request.method === "OPTIONS") return json({}, 204, origin);
  if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405, origin);
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_ROLE_KEY) return json({ error: "meta_admin_not_configured" }, 503, origin);

  let context: Awaited<ReturnType<typeof authorize>>;
  try { context = await authorize(request); }
  catch (error) {
    const code = error instanceof Error ? error.message : "access_denied";
    const status = code === "authentication_required" || code === "invalid_session" ? 401 : code === "administrator_required" ? 403 : 403;
    return json({ error: code }, status, origin);
  }

  let body: Record<string, unknown>;
  try { body = await readJson(request); }
  catch (error) { return json({ error: error instanceof Error ? error.message : "invalid_request" }, 400, origin); }
  const action = String(body.action ?? "");

  try {
    const settings = await getSettings(context.admin);
    if (action === "save_app") {
      const appId = String(body.app_id ?? "").trim();
      const configId = String(body.config_id ?? "").trim();
      const appSecret = String(body.app_secret ?? "").trim();
      if (!/^\d{5,32}$/.test(appId) || !/^\d{8,32}$/.test(configId) || appSecret.length < 8 || appSecret.length > 512 || /[\r\n]/.test(appSecret)) {
        return json({ error: "invalid_meta_app_credentials" }, 422, origin);
      }
      let credential: Record<string, unknown> = {};
      if (settings?.secret_reference) credential = await readSecret(context.admin, String(settings.secret_reference));
      const appChanged = credential.app_id !== appId;
      const configurationChanged = appChanged || credential.config_id !== configId;
      const verifyToken = appChanged || typeof credential.verify_token !== "string" ? randomSecret() : credential.verify_token;
      const nextSecret = {
        app_id: appId,
        app_secret: appSecret,
        verify_token: verifyToken,
        config_id: configId,
        ...(configurationChanged ? {} : Object.fromEntries(Object.entries(credential).filter(([key]) => !["app_id", "app_secret", "config_id"].includes(key)))),
      };
      const { data: secretId, error: secretError } = await context.admin.rpc("meta_instagram_secret_store", {
        p_secret: JSON.stringify(nextSecret), p_secret_id: settings?.secret_reference ?? null,
      });
      if (secretError || !secretId) return json({ error: "secure_secret_storage_unavailable" }, 503, origin);
      const publicConfig = {
        ...(appChanged ? {} : (settings?.public_config ?? {})),
        app_id: appId,
        config_id: configId,
        auth_flow: "instagram_unified_login",
        callback_url: `${SUPABASE_URL.replace(/\/+$/, "")}/functions/v1/meta-instagram-oauth-callback`,
        app_configured_at: new Date().toISOString(),
      };
      await saveSettings(context.admin, context.user.id, {
        status: configurationChanged ? "not_configured" : settings?.status ?? "not_configured",
        public_config: publicConfig, secret_reference: String(secretId),
      });
      return json({
        configured: true,
        app_id: appId,
        config_id: configId,
        callback_url: publicConfig.callback_url,
        business_callback_url: `${SUPABASE_URL.replace(/\/+$/, "")}/functions/v1/meta-business-oauth-callback`,
        webhook_url: `${SUPABASE_URL.replace(/\/+$/, "")}/functions/v1/meta-webhook`,
      }, 200, origin);
    }

    if (action === "get_webhook_token") {
      if (!settings?.secret_reference) return json({ error: "meta_app_setup_required" }, 409, origin);
      const secret = await readSecret(context.admin, String(settings.secret_reference));
      if (typeof secret.verify_token !== "string" || secret.verify_token.length < 32) return json({ error: "webhook_token_unavailable" }, 503, origin);
      return json({ webhook_url: `${SUPABASE_URL.replace(/\/+$/, "")}/functions/v1/meta-webhook`, webhook_verify_token: secret.verify_token }, 200, origin);
    }

    if (action === "subscribe_messages") {
      const usable = await ensureUsableCredentials(context.admin, context.user.id, settings as Record<string, unknown> ?? {});
      await subscribeInstagramMessages({ accountId: usable.identity.id, accessToken: usable.accessToken });
      const subscribedAt = new Date().toISOString();
      const nextSettings = {
        ...settings,
        public_config: {
          ...(settings?.public_config ?? {}),
          messages_webhook_subscribed: true,
          messages_webhook_subscribed_at: subscribedAt,
          messages_webhook_subscribed_account_id: usable.identity.id,
        },
      };
      await saveSettings(context.admin, context.user.id, nextSettings);
      return json({
        subscribed: true,
        field: "messages",
        username: usable.identity.username,
        account_id: usable.identity.id,
        subscribed_at: subscribedAt,
      }, 200, origin);
    }

    if (action === "status") {
      const appConfigured = Boolean(settings?.secret_reference && /^\d{5,32}$/.test(String(settings?.public_config?.app_id ?? "")) && /^\d{8,32}$/.test(String(settings?.public_config?.config_id ?? "")));
      if (!appConfigured) return json({ status: "not_configured", app_configured: false, connected: false,
        callback_url: `${SUPABASE_URL.replace(/\/+$/, "")}/functions/v1/meta-instagram-oauth-callback`,
        business_callback_url: `${SUPABASE_URL.replace(/\/+$/, "")}/functions/v1/meta-business-oauth-callback`,
        webhook_url: `${SUPABASE_URL.replace(/\/+$/, "")}/functions/v1/meta-webhook` }, 200, origin);
      const secret = await readSecret(context.admin, String(settings?.secret_reference));
      const businessCheck = settings.public_config?.business_portfolio_check ?? null;
      if (!secret.access_token) return json({ status: "awaiting_authorization", app_configured: true, connected: false, app_id: settings?.public_config?.app_id, config_id: settings?.public_config?.config_id, callback_url: settings?.public_config?.callback_url, business_callback_url: `${SUPABASE_URL.replace(/\/+$/, "")}/functions/v1/meta-business-oauth-callback`, webhook_url: `${SUPABASE_URL.replace(/\/+$/, "")}/functions/v1/meta-webhook`, business_check: businessCheck }, 200, origin);
      try {
        const usable = await ensureUsableCredentials(context.admin, context.user.id, settings as Record<string, unknown>);
        return json({
          status: "configured", app_configured: true, connected: true,
          username: usable.identity.username, account_id: usable.identity.id,
          configured_permissions: settings?.public_config?.configured_permissions ?? [],
          messages_webhook_subscribed: settings?.public_config?.messages_webhook_subscribed === true,
          messages_webhook_subscribed_at: settings?.public_config?.messages_webhook_subscribed_at ?? null,
          token_expires_at: usable.expiresAt, refresh_warning: usable.refreshWarning,
          app_id: settings?.public_config?.app_id, config_id: settings?.public_config?.config_id, callback_url: settings?.public_config?.callback_url,
          business_callback_url: `${SUPABASE_URL.replace(/\/+$/, "")}/functions/v1/meta-business-oauth-callback`, business_check: businessCheck,
          webhook_url: `${SUPABASE_URL.replace(/\/+$/, "")}/functions/v1/meta-webhook`,
        }, 200, origin);
      } catch (error) {
        const code = error instanceof Error ? error.message : "instagram_status_unavailable";
        return json({ status: "reconnect_required", app_configured: true, connected: false, error: code, business_callback_url: `${SUPABASE_URL.replace(/\/+$/, "")}/functions/v1/meta-business-oauth-callback`, webhook_url: `${SUPABASE_URL.replace(/\/+$/, "")}/functions/v1/meta-webhook`, business_check: businessCheck }, 200, origin);
      }
    }

    if (action === "publish_image") {
      if (body.confirmed !== true) return json({ error: "explicit_publish_confirmation_required" }, 422, origin);
      const content = validateInstagramImagePublication({ image_url: body.image_url, caption: body.caption });
      const usable = await ensureUsableCredentials(context.admin, context.user.id, settings as Record<string, unknown> ?? {});
      const published = await publishInstagramImage({
        accountId: usable.identity.id, accessToken: usable.accessToken,
        imageUrl: content.imageUrl, caption: content.caption, graphVersion: GRAPH_VERSION,
      });
      return json({ published: true, media_id: published.mediaId, username: usable.identity.username }, 200, origin);
    }

    return json({ error: "unsupported_action" }, 400, origin);
  } catch (error) {
    const code = error instanceof Error && /^[a-z0-9_]{1,64}$/.test(error.message) ? error.message : "meta_operation_failed";
    return json({ error: code }, 503, origin);
  }
});


