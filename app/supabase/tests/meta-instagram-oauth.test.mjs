import test from "node:test";
import assert from "node:assert/strict";
import {
  INSTAGRAM_OAUTH_SCOPES,
  buildMetaBusinessAuthorizationUrl,
  buildInstagramAuthorizationUrl,
  exchangeMetaBusinessCode,
  exchangeForLongLivedToken,
  exchangeInstagramCode,
  getInstagramIdentity,
  isExpectedInstagramAccount,
  inspectMetaBusinessInstagramLink,
  publishInstagramImage,
  refreshLongLivedToken,
  sha256Hex,
  validateInstagramImagePublication,
} from "../functions/meta-instagram/logic.mjs";

test("OAuth usa Instagram Login oficial, callback exato, state e permissões atuais", () => {
  const url = new URL(buildInstagramAuthorizationUrl({
    appId: "123456789012345",
    redirectUri: "https://nmkneyzyxxhebkurgimh.supabase.co/functions/v1/meta-instagram-oauth-callback",
    state: "state-value-generated-with-more-than-32-characters",
  }));
  assert.equal(url.origin, "https://www.instagram.com");
  assert.equal(url.pathname, "/oauth/authorize");
  assert.equal(url.searchParams.get("response_type"), "code");
  assert.equal(url.searchParams.get("state"), "state-value-generated-with-more-than-32-characters");
  assert.deepEqual(url.searchParams.get("scope").split(","), [...INSTAGRAM_OAUTH_SCOPES]);
  assert.throws(() => buildInstagramAuthorizationUrl({ appId: "bad", redirectUri: "http://localhost/callback", state: "state" }));
});

test("verificação de Portfólio pede somente business_management e usa callback fechado", () => {
  const url = new URL(buildMetaBusinessAuthorizationUrl({
    appId: "123456789012345",
    redirectUri: "https://nmkneyzyxxhebkurgimh.supabase.co/functions/v1/meta-business-oauth-callback",
    state: "business-state-with-at-least-thirty-two-characters",
  }));
  assert.equal(url.origin, "https://www.facebook.com");
  assert.equal(url.pathname, "/v27.0/dialog/oauth");
  assert.equal(url.searchParams.get("scope"), "business_management");
  assert.equal(url.searchParams.get("state"), "business-state-with-at-least-thirty-two-characters");
});

test("Business OAuth troca code no Graph oficial e mantém callback exato", async () => {
  let requestUrl = "";
  const token = await exchangeMetaBusinessCode({
    appId: "123456789012345", appSecret: "synthetic-app-secret",
    redirectUri: "https://example.org/meta-business-callback", code: "single-use-code",
    fetchImpl: async (url) => { requestUrl = String(url); return Response.json({ access_token: "synthetic-business-token", token_type: "bearer" }); },
  });
  const url = new URL(requestUrl);
  assert.equal(url.origin, "https://graph.facebook.com");
  assert.equal(url.pathname, "/v27.0/oauth/access_token");
  assert.equal(url.searchParams.get("redirect_uri"), "https://example.org/meta-business-callback");
  assert.equal(url.searchParams.get("client_secret"), "synthetic-app-secret");
  assert.equal(token, "synthetic-business-token");
});

test("consulta de Portfólio diferencia ativo próprio e ativo compartilhado, sem alterar relações", async () => {
  const requested = [];
  const owned = await inspectMetaBusinessInstagramLink({
    accessToken: "synthetic-business-token",
    fetchImpl: async (url, options) => {
      requested.push(String(url));
      assert.equal(options.headers.Authorization, "Bearer synthetic-business-token");
      const parsed = new URL(url);
      if (parsed.pathname.endsWith("/me/businesses")) return Response.json({ data: [{ id: "123456789", name: "Desenrola Portfolio" }] });
      if (parsed.pathname.endsWith("/owned_instagram_assets")) return Response.json({ data: [{ id: "17840000000000001", username: "cristianebritto.desenrola" }] });
      return Response.json({ data: [] });
    },
  });
  assert.equal(owned.status, "owned");
  assert.equal(owned.matchingPortfolio, "Desenrola Portfolio");
  assert.equal(requested.length, 2);

  const shared = await inspectMetaBusinessInstagramLink({
    accessToken: "synthetic-business-token",
    fetchImpl: async (url) => {
      const parsed = new URL(url);
      if (parsed.pathname.endsWith("/me/businesses")) return Response.json({ data: [{ id: "987654321", name: "Client Portfolio" }] });
      if (parsed.pathname.endsWith("/owned_instagram_assets")) return Response.json({ data: [] });
      return Response.json({ data: [{ id: "17840000000000001", username: "cristianebritto.desenrola" }] });
    },
  });
  assert.equal(shared.status, "managed_by_client_business");
});

test("hash OAuth state é SHA-256 hexadecimal, sem persistir o state em claro", async () => {
  assert.equal(await sha256Hex("synthetic-state"), await sha256Hex("synthetic-state"));
  assert.match(await sha256Hex("synthetic-state"), /^[a-f0-9]{64}$/);
  assert.notEqual(await sha256Hex("synthetic-state"), "synthetic-state");
});

test("troca o authorization code uma vez no endpoint oficial e não inclui segredo em query string", async () => {
  let request;
  const result = await exchangeInstagramCode({
    appId: "123456789012345", appSecret: "synthetic-app-secret", redirectUri: "https://example.org/callback",
    code: "synthetic-one-use-code#_",
    fetchImpl: async (url, options) => {
      request = { url: String(url), options };
      return Response.json({ access_token: "synthetic-short-lived-access-token", user_id: "17840000000000001", permissions: "instagram_business_basic" });
    },
  });
  assert.equal(request.url, "https://api.instagram.com/oauth/access_token");
  assert.equal(request.options.method, "POST");
  assert.equal(request.options.body.get("client_secret"), "synthetic-app-secret");
  assert.equal(request.options.body.get("code"), "synthetic-one-use-code");
  assert.equal(result.access_token, "synthetic-short-lived-access-token");
});

test("troca e renova token longo somente nos endpoints oficiais", async () => {
  let exchangeUrl = "";
  const exchanged = await exchangeForLongLivedToken({
    appSecret: "synthetic-app-secret", shortLivedToken: "synthetic-short-token",
    fetchImpl: async (url) => { exchangeUrl = String(url); return Response.json({ access_token: "synthetic-long-token", token_type: "bearer", expires_in: 5_184_000 }); },
  });
  assert.equal(new URL(exchangeUrl).origin, "https://graph.instagram.com");
  assert.equal(new URL(exchangeUrl).pathname, "/access_token");
  assert.equal(new URL(exchangeUrl).searchParams.get("grant_type"), "ig_exchange_token");
  assert.equal(exchanged.expiresIn, 5_184_000);

  let refreshUrl = "";
  const refreshed = await refreshLongLivedToken({
    accessToken: "synthetic-long-token",
    fetchImpl: async (url) => { refreshUrl = String(url); return Response.json({ access_token: "synthetic-refreshed-token", expires_in: 5_184_000 }); },
  });
  assert.equal(new URL(refreshUrl).pathname, "/refresh_access_token");
  assert.equal(new URL(refreshUrl).searchParams.get("grant_type"), "ig_refresh_token");
  assert.equal(refreshed.accessToken, "synthetic-refreshed-token");
});

test("identidade é lida via Graph API oficial e restringe a conta-alvo", async () => {
  let requestUrl = "";
  const identity = await getInstagramIdentity({
    accessToken: "synthetic-long-token",
    fetchImpl: async (url, options) => { requestUrl = String(url); assert.equal(options.headers.Authorization, "Bearer synthetic-long-token"); return Response.json({ id: "17840000000000001", username: "cristianebritto.desenrola" }); },
  });
  assert.equal(new URL(requestUrl).origin, "https://graph.instagram.com");
  assert.equal(isExpectedInstagramAccount(identity), true);
  assert.equal(isExpectedInstagramAccount({ username: "another.account" }), false);
});

test("publicação cria container, valida processamento e só então publica", async () => {
  const calls = [];
  const result = await publishInstagramImage({
    accountId: "17840000000000001", accessToken: "synthetic-long-token",
    imageUrl: "https://assets.example.org/approved-post.jpg", caption: "Conteúdo de homologação.", sleep: async () => {},
    fetchImpl: async (url, options) => {
      calls.push({ url: String(url), options });
      if (calls.length === 1) return Response.json({ id: "17940000000000001" });
      if (calls.length === 2) return Response.json({ status_code: "FINISHED" });
      return Response.json({ id: "18040000000000001" });
    },
  });
  assert.equal(calls.length, 3);
  assert.match(calls[0].url, /\/17840000000000001\/media$/);
  assert.match(calls[1].url, /\/17940000000000001\?fields=status_code$/);
  assert.match(calls[2].url, /\/17840000000000001\/media_publish$/);
  assert.equal(result.mediaId, "18040000000000001");
});

test("publicação rejeita URL insegura, credenciais embutidas e legenda vazia", () => {
  for (const imageUrl of ["http://assets.example.org/a.jpg", "https://user:pass@assets.example.org/a.jpg", "not-a-url"]) {
    assert.throws(() => validateInstagramImagePublication({ image_url: imageUrl, caption: "texto" }));
  }
  assert.throws(() => validateInstagramImagePublication({ image_url: "https://assets.example.org/a.jpg", caption: " " }));
});
