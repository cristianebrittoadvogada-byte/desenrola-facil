export const INSTAGRAM_OAUTH_SCOPES = Object.freeze([
  "instagram_business_basic",
  "instagram_business_content_publish",
  "instagram_business_manage_messages",
  "instagram_business_manage_comments",
]);

const VERSION_PATTERN = /^v\d+\.\d+$/;
const ACCOUNT_USERNAME = "cristianebritto.desenrola";

export function buildInstagramAuthorizationUrl({ appId, redirectUri, state, scopes = INSTAGRAM_OAUTH_SCOPES }) {
  if (!/^\d{5,32}$/.test(String(appId ?? ""))) throw new Error("invalid_meta_app_id");
  if (!isHttpsUrl(redirectUri) || !state || state.length < 32 || state.length > 256) throw new Error("invalid_oauth_request");
  const url = new URL("https://www.instagram.com/oauth/authorize");
  url.searchParams.set("client_id", String(appId));
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", scopes.join(","));
  url.searchParams.set("state", state);
  url.searchParams.set("enable_fb_login", "false");
  return url.toString();
}

export function buildMetaBusinessAuthorizationUrl({ appId, redirectUri, state, graphVersion = "v27.0" }) {
  if (!/^\d{5,32}$/.test(String(appId ?? "")) || !/^v\d+\.\d+$/.test(graphVersion)) throw new Error("invalid_meta_app_id");
  if (!isHttpsUrl(redirectUri) || !state || state.length < 32 || state.length > 256) throw new Error("invalid_oauth_request");
  const url = new URL(`https://www.facebook.com/${graphVersion}/dialog/oauth`);
  url.searchParams.set("client_id", String(appId));
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "business_management");
  url.searchParams.set("state", state);
  return url.toString();
}

export function isHttpsUrl(value) {
  try {
    const url = new URL(String(value));
    return url.protocol === "https:" && !url.username && !url.password && url.hostname.length <= 253;
  } catch {
    return false;
  }
}

export async function sha256Hex(value) {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
  return [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function tokenFromPayload(payload) {
  const candidate = Array.isArray(payload?.data) ? payload.data[0] : payload?.data ?? payload;
  if (!candidate || typeof candidate.access_token !== "string" || candidate.access_token.length < 20) {
    throw new Error("meta_token_exchange_failed");
  }
  return candidate;
}

async function checkedJson(response, failureCode) {
  const payload = await response.json().catch(() => null);
  if (!response.ok || payload?.error) throw new Error(failureCode);
  return payload;
}

export async function exchangeInstagramCode({ appId, appSecret, redirectUri, code, fetchImpl = fetch }) {
  if (!/^\d{5,32}$/.test(String(appId ?? "")) || !appSecret || !code || !isHttpsUrl(redirectUri)) {
    throw new Error("invalid_oauth_exchange");
  }
  const form = new FormData();
  form.set("client_id", appId);
  form.set("client_secret", appSecret);
  form.set("grant_type", "authorization_code");
  form.set("redirect_uri", redirectUri);
  form.set("code", code.replace(/#_$/, ""));
  const response = await fetchImpl("https://api.instagram.com/oauth/access_token", { method: "POST", body: form });
  return tokenFromPayload(await checkedJson(response, "meta_code_exchange_failed"));
}

export async function exchangeMetaBusinessCode({ appId, appSecret, redirectUri, code, graphVersion = "v27.0", fetchImpl = fetch }) {
  if (!/^\d{5,32}$/.test(String(appId ?? "")) || !appSecret || !code || !isHttpsUrl(redirectUri) || !/^v\d+\.\d+$/.test(graphVersion)) {
    throw new Error("invalid_oauth_exchange");
  }
  const url = new URL(`https://graph.facebook.com/${graphVersion}/oauth/access_token`);
  url.searchParams.set("client_id", appId);
  url.searchParams.set("client_secret", appSecret);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("code", code.replace(/#_$/, ""));
  const response = await fetchImpl(url, { headers: { Accept: "application/json" } });
  const payload = await checkedJson(response, "meta_business_code_exchange_failed");
  const token = tokenFromPayload(payload);
  return token.access_token;
}

async function fetchGraphPages(url, accessToken, fetchImpl) {
  let next = String(url);
  const rows = [];
  for (let page = 0; next && page < 10; page += 1) {
    const current = new URL(next);
    if (current.origin !== "https://graph.facebook.com") throw new Error("meta_business_pagination_invalid");
    const response = await fetchImpl(current, { headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" } });
    const payload = await checkedJson(response, "meta_business_assets_lookup_failed");
    if (!Array.isArray(payload.data)) throw new Error("meta_business_assets_lookup_failed");
    rows.push(...payload.data);
    next = typeof payload.paging?.next === "string" ? payload.paging.next : "";
  }
  return rows;
}

export async function inspectMetaBusinessInstagramLink({ accessToken, graphVersion = "v27.0", expectedUsername = ACCOUNT_USERNAME, fetchImpl = fetch }) {
  if (!/^v\d+\.\d+$/.test(graphVersion)) throw new Error("invalid_graph_version");
  const businesses = await fetchGraphPages(`https://graph.facebook.com/${graphVersion}/me/businesses?fields=id,name&limit=100`, accessToken, fetchImpl);
  const username = String(expectedUsername).replace(/^@/, "").toLowerCase();
  let managedMatch = null;
  for (const business of businesses) {
    const id = String(business?.id ?? "");
    if (!/^\d{5,32}$/.test(id)) continue;
    const owned = await fetchGraphPages(`https://graph.facebook.com/${graphVersion}/${id}/owned_instagram_assets?fields=id,username&limit=100`, accessToken, fetchImpl);
    if (owned.some((asset) => String(asset?.username ?? "").replace(/^@/, "").toLowerCase() === username)) {
      return { status: "owned", portfolioCount: businesses.length, matchingPortfolio: String(business.name ?? "") };
    }
    const client = await fetchGraphPages(`https://graph.facebook.com/${graphVersion}/${id}/client_instagram_assets?fields=id,username&limit=100`, accessToken, fetchImpl);
    if (!managedMatch && client.some((asset) => String(asset?.username ?? "").replace(/^@/, "").toLowerCase() === username)) {
      managedMatch = String(business.name ?? "");
    }
  }
  return managedMatch
    ? { status: "managed_by_client_business", portfolioCount: businesses.length, matchingPortfolio: managedMatch }
    : { status: "not_found", portfolioCount: businesses.length, matchingPortfolio: null };
}

export async function exchangeForLongLivedToken({ appSecret, shortLivedToken, fetchImpl = fetch }) {
  const url = new URL("https://graph.instagram.com/access_token");
  url.searchParams.set("grant_type", "ig_exchange_token");
  url.searchParams.set("client_secret", appSecret);
  url.searchParams.set("access_token", shortLivedToken);
  const response = await fetchImpl(url, { headers: { Accept: "application/json" } });
  const payload = await checkedJson(response, "meta_long_lived_exchange_failed");
  const token = tokenFromPayload(payload);
  const expiresIn = Number(token.expires_in);
  if (!Number.isFinite(expiresIn) || expiresIn < 86400) throw new Error("meta_expiry_unavailable");
  return { accessToken: token.access_token, expiresIn };
}

export async function refreshLongLivedToken({ accessToken, fetchImpl = fetch }) {
  const url = new URL("https://graph.instagram.com/refresh_access_token");
  url.searchParams.set("grant_type", "ig_refresh_token");
  url.searchParams.set("access_token", accessToken);
  const response = await fetchImpl(url, { headers: { Accept: "application/json" } });
  const payload = await checkedJson(response, "meta_token_refresh_failed");
  const token = tokenFromPayload(payload);
  const expiresIn = Number(token.expires_in);
  if (!Number.isFinite(expiresIn) || expiresIn < 86400) throw new Error("meta_expiry_unavailable");
  return { accessToken: token.access_token, expiresIn };
}

export async function getInstagramIdentity({ accessToken, graphVersion = "v27.0", fetchImpl = fetch }) {
  if (!VERSION_PATTERN.test(graphVersion)) throw new Error("invalid_graph_version");
  const url = new URL(`https://graph.instagram.com/${graphVersion}/me`);
  url.searchParams.set("fields", "id,username");
  const response = await fetchImpl(url, { headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" } });
  const data = await checkedJson(response, "meta_identity_lookup_failed");
  const id = String(data.id ?? data.user_id ?? "");
  const username = String(data.username ?? "").replace(/^@/, "").toLowerCase();
  if (!/^\d{5,32}$/.test(id) || !/^[a-z0-9._]{1,30}$/.test(username)) throw new Error("meta_identity_unavailable");
  return { id, username };
}

export function isExpectedInstagramAccount(identity) {
  return String(identity?.username ?? "").replace(/^@/, "").toLowerCase() === ACCOUNT_USERNAME;
}

export function validateInstagramImagePublication(input) {
  const imageUrl = String(input?.image_url ?? "").trim();
  const caption = String(input?.caption ?? "").trim();
  if (!isHttpsUrl(imageUrl) || imageUrl.length > 2000) throw new Error("invalid_public_image_url");
  if (new TextEncoder().encode(caption).byteLength > 2200) throw new Error("caption_too_long");
  if (!caption) throw new Error("caption_required");
  return { imageUrl, caption };
}

export async function publishInstagramImage({ accountId, accessToken, imageUrl, caption, graphVersion = "v27.0", fetchImpl = fetch, sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)) }) {
  if (!/^\d{5,32}$/.test(String(accountId ?? "")) || !VERSION_PATTERN.test(graphVersion)) throw new Error("invalid_instagram_publication_target");
  const validated = validateInstagramImagePublication({ image_url: imageUrl, caption });
  const headers = { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json", Accept: "application/json" };
  const containerResponse = await fetchImpl(`https://graph.instagram.com/${graphVersion}/${accountId}/media`, {
    method: "POST", headers, body: JSON.stringify({ image_url: validated.imageUrl, caption: validated.caption }),
  });
  const container = await checkedJson(containerResponse, "meta_media_container_failed");
  if (!/^\d{5,40}$/.test(String(container.id ?? ""))) throw new Error("meta_media_container_failed");

  let ready = false;
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const statusUrl = new URL(`https://graph.instagram.com/${graphVersion}/${container.id}`);
    statusUrl.searchParams.set("fields", "status_code");
    const statusResponse = await fetchImpl(statusUrl, { headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" } });
    const status = await checkedJson(statusResponse, "meta_media_status_failed");
    if (status.status_code === "FINISHED") { ready = true; break; }
    if (status.status_code === "ERROR" || status.status_code === "EXPIRED") throw new Error("meta_media_container_not_publishable");
    await sleep(1000);
  }
  if (!ready) throw new Error("meta_media_processing_timeout");

  const publishResponse = await fetchImpl(`https://graph.instagram.com/${graphVersion}/${accountId}/media_publish`, {
    method: "POST", headers, body: JSON.stringify({ creation_id: container.id }),
  });
  const published = await checkedJson(publishResponse, "meta_publish_failed");
  if (!/^\d{5,40}$/.test(String(published.id ?? ""))) throw new Error("meta_publish_failed");
  return { mediaId: published.id, containerId: container.id };
}

export function instagramOAuthConfiguration({ appId, callbackUrl }) {
  return { appId: String(appId ?? ""), callbackUrl, expectedUsername: ACCOUNT_USERNAME, scopes: [...INSTAGRAM_OAUTH_SCOPES] };
}
