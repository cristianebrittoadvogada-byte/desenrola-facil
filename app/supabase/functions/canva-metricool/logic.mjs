const CANVA_OAUTH = "https://www.canva.com/api/oauth/authorize";
const CANVA_TOKEN = "https://api.canva.com/rest/v1/oauth/token";
const CANVA_API = "https://api.canva.com/rest/v1";

function base64Url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export async function sha256Hex(value) {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
  return [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function createCanvaOAuthParameters({ clientId, redirectUri, cryptoImpl = crypto }) {
  if (!/^.{5,256}$/.test(String(clientId ?? ""))) throw new Error("invalid_canva_client_id");
  const state = base64Url(cryptoImpl.getRandomValues(new Uint8Array(32)));
  const verifier = base64Url(cryptoImpl.getRandomValues(new Uint8Array(48)));
  const challenge = base64Url(new Uint8Array(await cryptoImpl.subtle.digest("SHA-256", new TextEncoder().encode(verifier))));
  const url = new URL(CANVA_OAUTH);
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "design:content:read");
  url.searchParams.set("code_challenge", challenge);
  url.searchParams.set("code_challenge_method", "s256");
  url.searchParams.set("state", state);
  url.searchParams.set("redirect_uri", redirectUri);
  return { state, verifier, authorizationUrl: url.toString() };
}

export function extractCanvaDesignId(input) {
  const raw = String(input ?? "").trim();
  if (/^[A-Za-z0-9_-]{5,128}$/.test(raw)) return raw;
  let url;
  try { url = new URL(raw); } catch { throw new Error("invalid_canva_design_url"); }
  if (!/(^|\.)canva\.com$/i.test(url.hostname) || url.protocol !== "https:") throw new Error("invalid_canva_design_url");
  const match = url.pathname.match(/^\/design\/([A-Za-z0-9_-]{5,128})(?:\/|$)/);
  if (!match) throw new Error("invalid_canva_design_url");
  return match[1];
}

export function buildCanvaExportRequest({ designId, format = "png" }) {
  if (!/^[A-Za-z0-9_-]{5,128}$/.test(String(designId ?? ""))) throw new Error("invalid_design_id");
  if (!new Set(["png", "jpg"]).has(format)) throw new Error("unsupported_export_format");
  return { design_id: designId, format: { type: format, export_quality: "regular" } };
}

export function orderedCanvaExportUrls(response) {
  const job = response?.job ?? response;
  if (job?.status !== "success" || !Array.isArray(job.urls) || job.urls.length < 1 || job.urls.length > 10) {
    throw new Error(job?.status === "in_progress" ? "export_still_processing" : "export_result_invalid");
  }
  return job.urls.map((value, index) => {
    const url = new URL(String(value));
    if (url.protocol !== "https:" || !/(^|\.)canva\.com$/i.test(url.hostname)) throw new Error("export_host_not_allowed");
    return { page: index + 1, url: url.toString() };
  });
}

export function makeStoragePath(jobId, pageIndex, extension) {
  if (!/^[0-9a-f-]{36}$/i.test(String(jobId)) || !Number.isInteger(pageIndex) || pageIndex < 0 || pageIndex > 9) throw new Error("invalid_storage_path");
  if (!new Set(["png", "jpg"]).has(extension)) throw new Error("invalid_storage_extension");
  return `${jobId}/${String(pageIndex + 1).padStart(2, "0")}.${extension}`;
}

export async function contentIdempotencyKey({ designId, caption, scheduledAt, format = "png" }) {
  const normalizedSchedule = new Date(scheduledAt).toISOString();
  return sha256Hex([String(designId), String(format), normalizedSchedule, String(caption).trim()].join("\n"));
}

export function buildMetricoolSchedulePayload({ caption, scheduledAt, timezone, orderedMediaUrls }) {
  const time = Date.parse(String(scheduledAt ?? ""));
  if (!Number.isFinite(time) || time <= Date.now()) throw new Error("schedule_must_be_future");
  if (typeof caption !== "string" || !caption.trim() || caption.length > 2200) throw new Error("invalid_caption");
  if (typeof timezone !== "string" || timezone.length > 80) throw new Error("invalid_timezone");
  let local;
  try { local = new Intl.DateTimeFormat("sv-SE", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).format(new Date(time)); }
  catch { throw new Error("invalid_timezone"); }
  const [date, clock] = local.split(" ");
  const media = Array.isArray(orderedMediaUrls) ? orderedMediaUrls : [];
  if (!media.length || media.length > 10 || media.some((item) => typeof item !== "string" || !item.startsWith("https://"))) throw new Error("invalid_ordered_media");
  return {
    publicationDate: { dateTime: `${date}T${clock}`, timezone },
    text: caption.trim(),
    providers: [{ network: "instagram" }],
    media,
    autoPublish: true,
    saveExternalMediaFiles: true,
    instagramData: { type: media.length > 1 ? "CAROUSEL" : "POST", autoPublish: true },
  };
}

export async function exchangeCanvaToken({ clientId, clientSecret, code, codeVerifier, redirectUri, fetchImpl = fetch }) {
  const credentials = btoa(`${clientId}:${clientSecret}`);
  const form = new URLSearchParams({ grant_type: "authorization_code", code, code_verifier: codeVerifier, redirect_uri: redirectUri });
  const response = await fetchImpl(CANVA_TOKEN, { method: "POST", headers: { Authorization: `Basic ${credentials}`, "Content-Type": "application/x-www-form-urlencoded" }, body: form, signal: AbortSignal.timeout(10000) });
  if (!response.ok) throw new Error(`canva_token_http_${response.status}`);
  const body = await response.json();
  if (typeof body.access_token !== "string" || typeof body.refresh_token !== "string") throw new Error("canva_token_response_invalid");
  return { accessToken: body.access_token, refreshToken: body.refresh_token, expiresIn: Number(body.expires_in) || 0 };
}

export async function refreshCanvaToken({ clientId, clientSecret, refreshToken, fetchImpl = fetch }) {
  const credentials = btoa(`${clientId}:${clientSecret}`);
  const form = new URLSearchParams({ grant_type: "refresh_token", refresh_token: refreshToken });
  const response = await fetchImpl(CANVA_TOKEN, { method: "POST", headers: { Authorization: `Basic ${credentials}`, "Content-Type": "application/x-www-form-urlencoded" }, body: form, signal: AbortSignal.timeout(10000) });
  if (!response.ok) throw new Error(`canva_refresh_http_${response.status}`);
  const body = await response.json();
  if (typeof body.access_token !== "string" || typeof body.refresh_token !== "string") throw new Error("canva_refresh_response_invalid");
  return { accessToken: body.access_token, refreshToken: body.refresh_token, expiresIn: Number(body.expires_in) || 0 };
}

export async function canvaRequest(path, { accessToken, method = "GET", body, fetchImpl = fetch }) {
  if (!/^\/(?:exports|designs)(?:\/|$)/.test(path)) throw new Error("canva_endpoint_not_allowed");
  const response = await fetchImpl(`${CANVA_API}${path}`, {
    method,
    headers: { Authorization: `Bearer ${accessToken}`, ...(body ? { "Content-Type": "application/json" } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error(`canva_api_http_${response.status}`);
  return response.json();
}

export async function normalizeMetricoolMedia({ url, token, userId, blogId, fetchImpl = fetch }) {
  const normalizedInput = new URL(url);
  if (normalizedInput.protocol !== "https:") throw new Error("media_url_must_be_https");
  const endpoint = new URL("https://app.metricool.com/api/actions/normalize/image/url");
  endpoint.searchParams.set("url", normalizedInput.toString());
  endpoint.searchParams.set("userId", userId);
  endpoint.searchParams.set("blogId", blogId);
  endpoint.searchParams.set("detailedErrors", "true");
  const response = await fetchImpl(endpoint, { headers: { "X-Mc-Auth": token }, signal: AbortSignal.timeout(20000) });
  if (!response.ok) throw new Error(`metricool_normalize_http_${response.status}`);
  const body = await response.json();
  const normalized = body?.data?.url ?? body?.url ?? body?.data;
  if (typeof normalized !== "string" || !normalized.startsWith("https://")) throw new Error("metricool_normalize_invalid");
  return normalized;
}

