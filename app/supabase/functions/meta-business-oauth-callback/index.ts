import { createClient } from "@supabase/supabase-js";
import { exchangeMetaBusinessCode, inspectMetaBusinessInstagramLink, sha256Hex } from "../meta-instagram/logic.mjs";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const GRAPH_VERSION = Deno.env.get("META_GRAPH_VERSION") ?? "v27.0";
const PANEL_URL = "https://desenrola-facil-painel-72oq.onrender.com/";

function redirectResult(result: string, code = "") {
  const url = new URL(PANEL_URL);
  url.searchParams.set("meta_business", result);
  if (code) url.searchParams.set("code", code);
  return Response.redirect(url.toString(), 303);
}

Deno.serve(async (request: Request) => {
  if (request.method !== "GET") return new Response("Method not allowed", { status: 405 });
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return redirectResult("error", "oauth_unavailable");
  const url = new URL(request.url);
  const state = url.searchParams.get("state") ?? "";
  if (state.length < 32 || state.length > 256) return redirectResult("error", "invalid_state");

  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const stateHash = await sha256Hex(`business:${state}`);
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
    const { data: secretData, error: secretError } = await admin.rpc("meta_instagram_secret_read", { p_secret_id: settings.secret_reference });
    if (secretError || typeof secretData !== "string") throw new Error("app_setup_required");
    let secret: Record<string, unknown>;
    try { secret = JSON.parse(secretData); } catch { throw new Error("app_setup_required"); }
    if (secret.app_id !== appId || typeof secret.app_secret !== "string" || secret.app_secret.length < 8) throw new Error("app_setup_required");

    const callbackUrl = `${SUPABASE_URL.replace(/\/+$/, "")}/functions/v1/meta-business-oauth-callback`;
    const accessToken = await exchangeMetaBusinessCode({ appId, appSecret: secret.app_secret, redirectUri: callbackUrl, code, graphVersion: GRAPH_VERSION });
    const check = await inspectMetaBusinessInstagramLink({ accessToken, graphVersion: GRAPH_VERSION });
    const businessPortfolioCheck = {
      status: check.status,
      portfolio_count: check.portfolioCount,
      matching_portfolio: check.matchingPortfolio,
      checked_at: new Date().toISOString(),
    };
    const publicConfig = { ...(settings.public_config ?? {}), business_portfolio_check: businessPortfolioCheck };
    const { error: saveError } = await admin.from("integration_settings").upsert({
      provider: "instagram_graph", status: settings.status ?? "not_configured", public_config,
      secret_reference: settings.secret_reference, updated_by: consumed.initiated_by,
    }, { onConflict: "provider" });
    if (saveError) throw new Error("business_check_save_failed");
    return redirectResult("checked");
  } catch (error) {
    const safeCode = error instanceof Error && /^[a-z0-9_]{1,64}$/.test(error.message) ? error.message : "business_check_failed";
    return redirectResult("error", safeCode);
  }
});
