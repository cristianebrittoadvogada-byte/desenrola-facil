import { createClient } from "@supabase/supabase-js";
import {
  buildCanvaExportRequest, buildMetricoolSchedulePayload, canvaRequest,
  contentIdempotencyKey, createCanvaOAuthParameters, exchangeCanvaToken, extractCanvaDesignId,
  makeStoragePath, normalizeMetricoolMedia, orderedCanvaExportUrls, refreshCanvaToken,
} from "./logic.mjs";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const PANEL_URL = "https://desenrola-facil-painel-72oq.onrender.com/";
const BUCKET = "df-social-assets-private";
const MAX_IMAGE_BYTES = 15 * 1024 * 1024;
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

function redirect(result: string, code = "") {
  const target = new URL(PANEL_URL);
  target.searchParams.set("canva_oauth", result);
  if (code) target.searchParams.set("code", code);
  return Response.redirect(target.toString(), 303);
}

async function readBody(request: Request) {
  const raw = await request.text();
  if (new TextEncoder().encode(raw).byteLength > 24_000) throw new Error("request_too_large");
  const value = JSON.parse(raw);
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("invalid_request");
  return value as Record<string, unknown>;
}

function validFutureSchedule(value: unknown) {
  const timestamp = Date.parse(String(value ?? ""));
  return Number.isFinite(timestamp) && timestamp > Date.now();
}

async function adminContext(request: Request) {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SERVICE_ROLE_KEY) throw new Error("service_not_configured");
  const authorization = request.headers.get("Authorization");
  if (!authorization?.startsWith("Bearer ")) throw new Error("authentication_required");
  const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authorization } }, auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: auth, error: authError } = await userClient.auth.getUser();
  if (authError || !auth.user) throw new Error("invalid_session");
  const { data: roles, error: roleError } = await userClient.from("user_roles").select("role").eq("user_id", auth.user.id);
  if (roleError) throw new Error("role_check_failed");
  if (!(roles ?? []).some((row) => ["owner", "admin"].includes(row.role))) throw new Error("administrator_required");
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  return { user: auth.user, admin };
}

async function getSetting(admin: ReturnType<typeof createClient>, provider: string) {
  const { data, error } = await admin.from("content_integration_settings")
    .select("provider,status,public_config,secret_reference,token_refresh_lock_until")
    .eq("provider", provider).maybeSingle();
  if (error) throw new Error("integration_settings_unavailable");
  return data;
}

async function readCredential(admin: ReturnType<typeof createClient>, provider: string, setting: Record<string, unknown> | null) {
  if (!setting?.secret_reference) return null;
  const { data, error } = await admin.rpc("content_secret_read", { p_provider: provider, p_secret_id: setting.secret_reference });
  if (error || typeof data !== "string") return null;
  try { return JSON.parse(data) as Record<string, unknown>; } catch { return null; }
}

async function storeCredential(admin: ReturnType<typeof createClient>, provider: string, value: Record<string, unknown>, secretId: string | null = null) {
  const { data, error } = await admin.rpc("content_secret_store", {
    p_provider: provider, p_secret: JSON.stringify(value), p_secret_id: secretId,
  });
  if (error || typeof data !== "string") throw new Error("secure_secret_storage_unavailable");
  return data;
}

async function saveSetting(admin: ReturnType<typeof createClient>, userId: string, provider: string, status: string, publicConfig: Record<string, unknown>, secretReference: string) {
  const { error } = await admin.from("content_integration_settings").upsert({
    provider, status, public_config: publicConfig, secret_reference: secretReference,
    updated_by: userId, updated_at: new Date().toISOString(),
  }, { onConflict: "provider" });
  if (error) throw new Error("integration_settings_save_failed");
}

async function readyCanva(admin: ReturnType<typeof createClient>) {
  const setting = await getSetting(admin, "canva");
  const credential = await readCredential(admin, "canva", setting);
  if (!credential || typeof credential.client_id !== "string" || typeof credential.client_secret !== "string") throw new Error("canva_not_connected");
  if (typeof credential.access_token !== "string" || typeof credential.refresh_token !== "string") throw new Error("canva_not_connected");
  const expiresAt = Date.parse(String(credential.token_expires_at ?? ""));
  if (!Number.isFinite(expiresAt) || expiresAt > Date.now() + 120_000) return { setting, credential };

  const { data: claimed, error: lockError } = await admin.rpc("content_claim_canva_refresh", { p_now: new Date().toISOString() });
  if (lockError) throw new Error("canva_refresh_lock_unavailable");
  if (claimed !== true) {
    await new Promise((resolve) => setTimeout(resolve, 500));
    const refreshed = await readCredential(admin, "canva", await getSetting(admin, "canva"));
    const refreshedAt = Date.parse(String(refreshed?.token_expires_at ?? ""));
    if (typeof refreshed?.access_token === "string" && Number.isFinite(refreshedAt) && refreshedAt > Date.now() + 120_000) return { setting, credential: refreshed };
    throw new Error("canva_refresh_in_progress");
  }
  try {
    const token = await refreshCanvaToken({
      clientId: String(credential.client_id), clientSecret: String(credential.client_secret),
      refreshToken: String(credential.refresh_token),
    });
    const next = {
      ...credential, access_token: token.accessToken, refresh_token: token.refreshToken,
      token_expires_at: new Date(Date.now() + token.expiresIn * 1000).toISOString(),
    };
    await storeCredential(admin, "canva", next, String(setting?.secret_reference));
    await admin.from("content_integration_settings").update({ token_refresh_lock_until: null, status: "connected", updated_at: new Date().toISOString() }).eq("provider", "canva");
    return { setting, credential: next };
  } catch {
    await admin.from("content_integration_settings").update({ status: "reauthorization_required", token_refresh_lock_until: null, updated_at: new Date().toISOString() }).eq("provider", "canva");
    throw new Error("canva_reauthorization_required");
  } finally {
    await admin.rpc("content_release_canva_refresh");
  }
}

async function readLimitedImage(response: Response) {
  if (!response.ok || !response.body) throw new Error("canva_export_download_failed");
  const mime = (response.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  if (!new Set(["image/png", "image/jpeg"]).has(mime)) throw new Error("canva_export_mime_unsupported");
  const length = Number(response.headers.get("content-length") ?? "0");
  if (length > MAX_IMAGE_BYTES) throw new Error("canva_export_too_large");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_IMAGE_BYTES) { await reader.cancel(); throw new Error("canva_export_too_large"); }
    chunks.push(value);
  }
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { merged.set(chunk, offset); offset += chunk.byteLength; }
  return { bytes: merged, mime };
}

async function downloadCanvaExport(url: string) {
  let current = new URL(url);
  for (let hop = 0; hop <= 3; hop++) {
    if (current.protocol !== "https:" || !/(^|\.)canva\.com$/i.test(current.hostname)) throw new Error("export_host_not_allowed");
    const response = await fetch(current, { redirect: "manual", signal: AbortSignal.timeout(15000) });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location || hop === 3) throw new Error("canva_export_redirect_invalid");
      current = new URL(location, current);
      continue;
    }
    return readLimitedImage(response);
  }
  throw new Error("canva_export_redirect_invalid");
}

async function signedAssets(admin: ReturnType<typeof createClient>, paths: string[], expiresIn: number) {
  const output: string[] = [];
  for (const path of paths) {
    const { data, error } = await admin.storage.from(BUCKET).createSignedUrl(path, expiresIn);
    if (error || !data?.signedUrl) throw new Error("asset_preview_unavailable");
    output.push(new URL(data.signedUrl, SUPABASE_URL).toString());
  }
  return output;
}

async function callback(request: Request) {
  const url = new URL(request.url);
  const state = url.searchParams.get("state") ?? "";
  const code = url.searchParams.get("code") ?? "";
  if (url.searchParams.has("error")) return redirect("error", "authorization_denied");
  if (state.length < 32 || state.length > 256 || !code || code.length > 4096) return redirect("error", "invalid_callback");
  try {
    const service = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
    const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(state));
    const stateHash = [...new Uint8Array(hash)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
    const now = new Date().toISOString();
    const { data: used, error } = await service.from("canva_oauth_states").update({ consumed_at: now })
      .eq("state_hash", stateHash).is("consumed_at", null).gt("expires_at", now)
      .select("code_verifier,initiated_by").maybeSingle();
    if (error || !used) return redirect("error", "state_expired_or_used");
    const setting = await getSetting(service, "canva");
    const credential = await readCredential(service, "canva", setting);
    if (!credential?.client_id || !credential?.client_secret) return redirect("error", "canva_app_not_configured");
    const redirectUri = `${SUPABASE_URL.replace(/\/+$/, "")}/functions/v1/canva-metricool?action=canva_callback`;
    const token = await exchangeCanvaToken({
      clientId: String(credential.client_id), clientSecret: String(credential.client_secret),
      code, codeVerifier: used.code_verifier, redirectUri,
    });
    const next = {
      ...credential, access_token: token.accessToken, refresh_token: token.refreshToken,
      token_expires_at: new Date(Date.now() + token.expiresIn * 1000).toISOString(),
    };
    const secretId = await storeCredential(service, "canva", next, String(setting?.secret_reference));
    await saveSetting(service, used.initiated_by, "canva", "connected", {
      ...(setting?.public_config ?? {}), connected_at: now, token_expires_at: next.token_expires_at,
      callback_url: redirectUri, scopes: ["design:content:read"],
    }, secretId);
    return redirect("connected");
  } catch {
    return redirect("error", "canva_token_exchange_failed");
  }
}

Deno.serve(async (request: Request) => {
  const url = new URL(request.url);
  if (request.method === "GET" && url.searchParams.get("action") === "canva_callback") {
    if (!SUPABASE_URL || !SERVICE_ROLE_KEY) return redirect("error", "service_not_configured");
    return callback(request);
  }
  const origin = request.headers.get("Origin") ?? "";
  if (request.method === "OPTIONS") return json({}, 204, origin);
  if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405, origin);

  let context: Awaited<ReturnType<typeof adminContext>>;
  try { context = await adminContext(request); }
  catch (error) {
    const code = error instanceof Error ? error.message : "access_denied";
    return json({ error: code }, code === "authentication_required" || code === "invalid_session" ? 401 : code === "administrator_required" ? 403 : 503, origin);
  }
  let body: Record<string, unknown>;
  try { body = await readBody(request); } catch (error) { return json({ error: error instanceof Error ? error.message : "invalid_request" }, 400, origin); }
  const { admin, user } = context;
  const action = String(body.action ?? "");

  try {
    if (action === "status") {
      const providers = ["canva", "metricool", "openai"];
      const rows = await Promise.all(providers.map((provider) => getSetting(admin, provider)));
      const result: Record<string, unknown> = {};
      for (let index = 0; index < providers.length; index++) {
        const provider = providers[index];
        const setting = rows[index];
        const credential = await readCredential(admin, provider, setting);
        result[provider] = {
          status: setting?.status ?? "not_configured",
          has_credentials: Boolean(setting?.secret_reference),
          connected: provider === "canva" ? Boolean(credential?.access_token) : setting?.status === "connected",
          ...(provider === "canva" ? { client_id: setting?.public_config?.client_id ?? null, callback_url: `${SUPABASE_URL}/functions/v1/canva-metricool?action=canva_callback`, token_expires_at: setting?.public_config?.token_expires_at ?? null } : {}),
          ...(provider === "metricool" ? { user_id: setting?.public_config?.user_id ?? null, blog_id: setting?.public_config?.blog_id ?? null } : {}),
          ...(provider === "openai" ? { model: setting?.public_config?.model ?? "gpt-4.1-mini" } : {}),
        };
      }
      return json({ integrations: result }, 200, origin);
    }

    if (action === "save_config") {
      const provider = String(body.provider ?? "");
      const setting = await getSetting(admin, provider);
      const existing = await readCredential(admin, provider, setting) ?? {};
      let secret: Record<string, unknown>;
      let publicConfig: Record<string, unknown>;
      let status = "configured";
      if (provider === "canva") {
        const clientId = String(body.client_id ?? "").trim();
        const clientSecret = String(body.client_secret ?? "").trim();
        if (clientId.length < 5 || clientId.length > 256 || clientSecret.length < 8 || clientSecret.length > 512) return json({ error: "invalid_canva_app_credentials" }, 422, origin);
        const sameClient = existing.client_id === clientId;
        secret = { client_id: clientId, client_secret: clientSecret, ...(sameClient ? Object.fromEntries(Object.entries(existing).filter(([key]) => !["client_id", "client_secret"].includes(key))) : {}) };
        publicConfig = { ...(sameClient ? setting?.public_config ?? {} : {}), client_id: clientId, app_configured_at: new Date().toISOString(), callback_url: `${SUPABASE_URL}/functions/v1/canva-metricool?action=canva_callback`, scopes: ["design:content:read"] };
      } else if (provider === "metricool") {
        const token = String(body.api_token ?? "").trim();
        const userId = String(body.user_id ?? "").trim();
        const blogId = String(body.blog_id ?? "").trim();
        if (token.length < 12 || token.length > 4096 || !/^\d+$/.test(userId) || !/^\d+$/.test(blogId)) return json({ error: "invalid_metricool_credentials" }, 422, origin);
        secret = { api_token: token };
        publicConfig = { user_id: userId, blog_id: blogId, configured_at: new Date().toISOString() };
      } else if (provider === "openai") {
        const apiKey = String(body.api_key ?? "").trim();
        const model = String(body.model ?? "gpt-4.1-mini").trim();
        if (apiKey.length < 20 || apiKey.length > 512 || !/^[A-Za-z0-9._-]{1,80}$/.test(model)) return json({ error: "invalid_ai_credentials" }, 422, origin);
        secret = { api_key: apiKey, model };
        publicConfig = { model, configured_at: new Date().toISOString() };
      } else return json({ error: "unsupported_provider" }, 422, origin);
      const secretId = await storeCredential(admin, provider, secret, setting?.secret_reference ?? null);
      await saveSetting(admin, user.id, provider, status, publicConfig, secretId);
      return json({ saved: true, provider }, 200, origin);
    }

    if (action === "verify_metricool") {
      const setting = await getSetting(admin, "metricool");
      const credential = await readCredential(admin, "metricool", setting);
      const userId = String(setting?.public_config?.user_id ?? "");
      const blogId = String(setting?.public_config?.blog_id ?? "");
      if (!credential?.api_token || !/^\d+$/.test(userId) || !/^\d+$/.test(blogId)) return json({ error: "metricool_not_configured" }, 409, origin);
      const endpoint = new URL("https://app.metricool.com/api/admin/simpleProfiles");
      endpoint.searchParams.set("userId", userId);
      const response = await fetch(endpoint, { headers: { "X-Mc-Auth": String(credential.api_token) }, signal: AbortSignal.timeout(12000) });
      if (!response.ok) return json({ verified: false, error: `metricool_api_http_${response.status}` }, 502, origin);
      const profiles = await response.json().catch(() => null);
      const items = Array.isArray(profiles) ? profiles : Array.isArray(profiles?.data) ? profiles.data : Array.isArray(profiles?.profiles) ? profiles.profiles : [];
      const found = items.some((item: Record<string, unknown>) => String(item.blogId ?? item.blog_id ?? item.id ?? "") === blogId);
      if (!found) return json({ verified: false, error: "metricool_brand_not_found" }, 422, origin);
      const { error: updateError } = await admin.from("content_integration_settings").update({ status: "connected", updated_at: new Date().toISOString() }).eq("provider", "metricool");
      if (updateError) return json({ error: "metricool_status_update_failed" }, 503, origin);
      return json({ verified: true, blog_id: blogId }, 200, origin);
    }

    if (action === "start_canva_oauth") {
      const setting = await getSetting(admin, "canva");
      const credential = await readCredential(admin, "canva", setting);
      if (!credential?.client_id) return json({ error: "canva_app_not_configured" }, 409, origin);
      const redirectUri = `${SUPABASE_URL.replace(/\/+$/, "")}/functions/v1/canva-metricool?action=canva_callback`;
      const parameters = await createCanvaOAuthParameters({ clientId: String(credential.client_id), redirectUri });
      const stateHash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(parameters.state));
      const hash = [...new Uint8Array(stateHash)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
      const { error } = await admin.from("canva_oauth_states").insert({
        state_hash: hash, code_verifier: parameters.verifier, initiated_by: user.id,
        expires_at: new Date(Date.now() + 10 * 60_000).toISOString(),
      });
      if (error) return json({ error: "canva_oauth_state_failed" }, 503, origin);
      return json({ authorization_url: parameters.authorizationUrl, callback_url: redirectUri, expires_in: 600 }, 200, origin);
    }

    if (action === "create_export") {
      const designId = extractCanvaDesignId(body.design_url ?? body.design_id);
      const caption = String(body.caption ?? "").trim();
      const scheduledAt = String(body.scheduled_at ?? "");
      const timezone = String(body.timezone ?? "America/Sao_Paulo");
      const format = body.format === "jpg" ? "jpg" : "png";
      if (!caption || caption.length > 2200 || !validFutureSchedule(scheduledAt)) return json({ error: "invalid_content_schedule" }, 422, origin);
      try { new Intl.DateTimeFormat("en", { timeZone: timezone }); } catch { return json({ error: "invalid_timezone" }, 422, origin); }
      const { credential } = await readyCanva(admin);
      const idempotencyKey = await contentIdempotencyKey({ designId, caption, scheduledAt: new Date(scheduledAt).toISOString(), format });
      const { data: job, error: jobError } = await admin.from("social_content_jobs").insert({
        created_by: user.id, design_id: designId, format, caption, scheduled_at: new Date(scheduledAt).toISOString(),
        timezone, status: "export_queued", idempotency_key: idempotencyKey,
      }).select("id,status").single();
      if (jobError?.code === "23505") {
        const { data: existing } = await admin.from("social_content_jobs").select("id,status").eq("idempotency_key", idempotencyKey).maybeSingle();
        return existing ? json({ id: existing.id, status: existing.status, duplicate: true }, 200, origin) : json({ error: "duplicate_content_request" }, 503, origin);
      }
      if (jobError || !job) return json({ error: "content_job_create_failed" }, 503, origin);
      try {
        const exportJob = await canvaRequest("/exports", { accessToken: String(credential.access_token), method: "POST", body: buildCanvaExportRequest({ designId, format }) });
        const exportId = exportJob?.job?.id;
        if (typeof exportId !== "string") throw new Error("export_job_response_invalid");
        await admin.from("social_content_jobs").update({ export_job_id: exportId, status: "exporting", updated_at: new Date().toISOString() }).eq("id", job.id);
        return json({ id: job.id, status: "exporting", page_order: "Canva export URLs are stored in provider page order." }, 201, origin);
      } catch (error) {
        const code = error instanceof Error && /^[a-z0-9_]{1,64}$/.test(error.message) ? error.message : "canva_export_start_failed";
        await admin.from("social_content_jobs").update({ status: "failed", safe_error_code: code, updated_at: new Date().toISOString() }).eq("id", job.id);
        return json({ error: code, id: job.id }, 503, origin);
      }
    }

    if (action === "poll_export") {
      const jobId = String(body.job_id ?? "");
      const { data: job, error: jobError } = await admin.from("social_content_jobs")
        .select("id,design_id,export_job_id,format,status,storage_paths")
        .eq("id", jobId).maybeSingle();
      if (jobError || !job) return json({ error: "content_job_not_found" }, 404, origin);
      if (job.status === "awaiting_approval") return json({ id: job.id, status: job.status, page_count: job.storage_paths.length, preview_urls: await signedAssets(admin, job.storage_paths, 300) }, 200, origin);
      if (job.status !== "exporting" || !job.export_job_id) return json({ id: job.id, status: job.status, error: job.safe_error_code }, 200, origin);
      const { credential } = await readyCanva(admin);
      const result = await canvaRequest(`/exports/${encodeURIComponent(job.export_job_id)}`, { accessToken: String(credential.access_token) });
      const providerJob = result?.job ?? result;
      if (providerJob.status === "in_progress") return json({ id: job.id, status: "exporting" }, 202, origin);
      if (providerJob.status !== "success") {
        await admin.from("social_content_jobs").update({ status: "failed", safe_error_code: "canva_export_failed", updated_at: new Date().toISOString() }).eq("id", job.id);
        return json({ id: job.id, status: "failed", error: "canva_export_failed" }, 502, origin);
      }
      const pages = orderedCanvaExportUrls(result);
      const paths: string[] = [];
      for (const page of pages) {
        const image = await downloadCanvaExport(page.url);
        const extension = image.mime === "image/png" ? "png" : "jpg";
        const path = makeStoragePath(job.id, page.page - 1, extension);
        const { error } = await admin.storage.from(BUCKET).upload(path, image.bytes, { contentType: image.mime, upsert: true, cacheControl: "3600" });
        if (error) {
          await admin.from("social_content_jobs").update({ status: "failed", safe_error_code: "private_asset_store_failed", updated_at: new Date().toISOString() }).eq("id", job.id);
          return json({ id: job.id, status: "failed", error: "private_asset_store_failed" }, 503, origin);
        }
        paths.push(path);
      }
      const { error: updateError } = await admin.from("social_content_jobs").update({
        storage_paths: paths, status: "awaiting_approval", safe_error_code: null, updated_at: new Date().toISOString(),
      }).eq("id", job.id).eq("status", "exporting");
      if (updateError) return json({ error: "content_job_update_failed" }, 503, origin);
      return json({ id: job.id, status: "awaiting_approval", page_count: paths.length, preview_urls: await signedAssets(admin, paths, 300) }, 200, origin);
    }

    if (action === "list_jobs") {
      const { data, error } = await admin.from("social_content_jobs")
        .select("id,design_id,format,caption,scheduled_at,timezone,status,storage_paths,approved_at,metricool_post_id,safe_error_code,created_at")
        .order("created_at", { ascending: false }).limit(30);
      if (error) return json({ error: "content_jobs_unavailable" }, 503, origin);
      const jobs = await Promise.all((data ?? []).map(async (job) => ({
        ...job, page_count: job.storage_paths.length,
        preview_urls: job.storage_paths.length ? await signedAssets(admin, job.storage_paths, 300) : [],
        storage_paths: undefined,
      })));
      return json({ jobs }, 200, origin);
    }

    if (action === "approve_and_schedule") {
      if (body.confirmed !== true) return json({ error: "explicit_approval_required" }, 422, origin);
      const jobId = String(body.job_id ?? "");
      const { data: current, error: currentError } = await admin.from("social_content_jobs")
        .select("id,status,caption,scheduled_at,timezone,storage_paths,metricool_post_id")
        .eq("id", jobId).maybeSingle();
      if (currentError || !current) return json({ error: "content_job_not_found" }, 404, origin);
      if (["scheduled", "scheduling", "needs_reconciliation"].includes(current.status)) return json({ id: current.id, status: current.status, metricool_post_id: current.metricool_post_id }, 200, origin);
      if (current.status !== "awaiting_approval") return json({ error: "content_waiting_for_export" }, 409, origin);
      if (!validFutureSchedule(current.scheduled_at) || !current.storage_paths?.length) return json({ error: "schedule_or_media_invalid" }, 422, origin);
      const { data: claimed, error: claimError } = await admin.from("social_content_jobs").update({
        status: "normalizing_media", approved_by: user.id, approved_at: new Date().toISOString(), safe_error_code: null, updated_at: new Date().toISOString(),
      }).eq("id", current.id).eq("status", "awaiting_approval").select("id").maybeSingle();
      if (claimError || !claimed) return json({ error: "content_job_already_claimed" }, 409, origin);

      const metricoolSetting = await getSetting(admin, "metricool");
      const metricoolSecret = await readCredential(admin, "metricool", metricoolSetting);
      const userId = String(metricoolSetting?.public_config?.user_id ?? "");
      const blogId = String(metricoolSetting?.public_config?.blog_id ?? "");
      if (!metricoolSecret?.api_token || !/^\d+$/.test(userId) || !/^\d+$/.test(blogId)) {
        await admin.from("social_content_jobs").update({ status: "failed", safe_error_code: "metricool_not_configured", updated_at: new Date().toISOString() }).eq("id", current.id);
        return json({ error: "metricool_not_configured", id: current.id }, 409, origin);
      }
      try {
        await admin.from("social_content_jobs").update({ status: "normalizing_media", updated_at: new Date().toISOString() }).eq("id", current.id);
        const signed = await signedAssets(admin, current.storage_paths, 900);
        const orderedMedia: string[] = [];
        for (const assetUrl of signed) orderedMedia.push(await normalizeMetricoolMedia({
          url: assetUrl, token: String(metricoolSecret.api_token), userId, blogId,
        }));
        await admin.from("social_content_jobs").update({ status: "scheduling", updated_at: new Date().toISOString() }).eq("id", current.id);
        const payload = buildMetricoolSchedulePayload({
          caption: current.caption, scheduledAt: current.scheduled_at, timezone: current.timezone, orderedMediaUrls: orderedMedia,
        });
        const endpoint = new URL("https://app.metricool.com/api/v2/scheduler/posts");
        endpoint.searchParams.set("userId", userId);
        endpoint.searchParams.set("blogId", blogId);
        const response = await fetch(endpoint, {
          method: "POST", headers: { "X-Mc-Auth": String(metricoolSecret.api_token), "Content-Type": "application/json" },
          body: JSON.stringify(payload), signal: AbortSignal.timeout(15000),
        });
        if (!response.ok) {
          const ambiguous = response.status >= 500;
          const status = ambiguous ? "needs_reconciliation" : "failed";
          await admin.from("social_content_jobs").update({ status, safe_error_code: `metricool_schedule_http_${response.status}`, updated_at: new Date().toISOString() }).eq("id", current.id);
          return json({ id: current.id, status, error: `metricool_schedule_http_${response.status}` }, ambiguous ? 202 : 502, origin);
        }
        const result = await response.json().catch(() => null);
        const remoteId = result?.data?.id ?? result?.data?.uuid ?? result?.id ?? result?.uuid ?? null;
        if (!remoteId) {
          await admin.from("social_content_jobs").update({ status: "needs_reconciliation", safe_error_code: "metricool_response_uncertain", updated_at: new Date().toISOString() }).eq("id", current.id);
          return json({ id: current.id, status: "needs_reconciliation", error: "metricool_response_uncertain" }, 202, origin);
        }
        await admin.from("social_content_jobs").update({ status: "scheduled", metricool_post_id: String(remoteId), safe_error_code: null, updated_at: new Date().toISOString() }).eq("id", current.id);
        return json({ id: current.id, status: "scheduled", metricool_post_id: String(remoteId) }, 200, origin);
      } catch (error) {
        const rawCode = error instanceof Error ? error.message : "content_schedule_failed";
        const code = /^[a-z0-9_]{1,64}$/.test(rawCode) ? rawCode : "content_schedule_failed";
        const uncertain = code.includes("unreachable") || code.includes("timeout") || code.includes("failed");
        const status = uncertain && code.startsWith("metricool_schedule") ? "needs_reconciliation" : "failed";
        await admin.from("social_content_jobs").update({ status, safe_error_code: code, updated_at: new Date().toISOString() }).eq("id", current.id);
        return json({ id: current.id, status, error: code }, status === "needs_reconciliation" ? 202 : 502, origin);
      }
    }

    return json({ error: "unsupported_action" }, 400, origin);
  } catch (error) {
    const raw = error instanceof Error ? error.message : "content_operation_failed";
    const code = /^[a-z0-9_]{1,64}$/.test(raw) ? raw : "content_operation_failed";
    return json({ error: code }, 503, origin);
  }
});

