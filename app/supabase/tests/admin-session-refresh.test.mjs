import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { createAuthSession } = require("../web/auth-session.js");
const ok = (body) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });

test("renova antes do vencimento e usa o refresh token rotacionado", async () => {
  const refreshRequests = [];
  const apiAuthorization = [];
  let refreshIndex = 0;
  const sessions = [
    { access_token: "fresh-access-1", refresh_token: "rotated-refresh-1", expires_in: 30 },
    { access_token: "fresh-access-2", refresh_token: "rotated-refresh-2", expires_in: 3600 },
  ];
  const auth = createAuthSession({
    getConfig: () => ({ url: "https://example.supabase.co", key: "public-test-key" }),
    fetchImpl: async (url, options) => {
      if (String(url).includes("grant_type=refresh_token")) {
        refreshRequests.push(JSON.parse(options.body).refresh_token);
        return ok(sessions[refreshIndex++]);
      }
      apiAuthorization.push(options.headers.get("Authorization"));
      return ok({ accepted: true });
    },
  });
  auth.setSession({ access_token: "expired-access", refresh_token: "initial-refresh", expires_in: 1 });

  await auth.request("https://example.supabase.co/functions/v1/meta-instagram-oauth-start", { method: "POST" });
  await auth.request("https://example.supabase.co/functions/v1/api/health", { method: "GET" });

  assert.deepEqual(refreshRequests, ["initial-refresh", "rotated-refresh-1"]);
  assert.deepEqual(apiAuthorization, ["Bearer fresh-access-1", "Bearer fresh-access-2"]);
});

test("compartilha uma renovação entre chamadas simultâneas", async () => {
  let refreshCalls = 0;
  let finishRefresh;
  let protectedCalls = 0;
  const auth = createAuthSession({
    getConfig: () => ({ url: "https://example.supabase.co", key: "public-test-key" }),
    fetchImpl: async (url) => {
      if (String(url).includes("grant_type=refresh_token")) {
        refreshCalls += 1;
        return new Promise((resolve) => { finishRefresh = () => resolve(ok({ access_token: "fresh", refresh_token: "rotated", expires_in: 3600 })); });
      }
      protectedCalls += 1;
      return ok({ accepted: true });
    },
  });
  auth.setSession({ access_token: "expired", refresh_token: "single-use-refresh", expires_in: 1 });

  const first = auth.request("https://example.supabase.co/functions/v1/api/a");
  const second = auth.request("https://example.supabase.co/functions/v1/api/b");
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(refreshCalls, 1);
  finishRefresh();
  await Promise.all([first, second]);
  assert.equal(protectedCalls, 2);
});

test("encerra a sessão quando o refresh token é rejeitado", async () => {
  let expiredSessions = 0;
  let protectedCalls = 0;
  const auth = createAuthSession({
    getConfig: () => ({ url: "https://example.supabase.co", key: "public-test-key" }),
    onExpired: () => { expiredSessions += 1; },
    fetchImpl: async (url) => {
      if (String(url).includes("grant_type=refresh_token")) return new Response(JSON.stringify({ error: "invalid_grant" }), { status: 400 });
      protectedCalls += 1;
      return ok({});
    },
  });
  auth.setSession({ access_token: "expired", refresh_token: "rejected-refresh", expires_in: 1 });

  await assert.rejects(auth.request("https://example.supabase.co/functions/v1/meta-instagram-oauth-start"), /Não foi possível renovar a sessão/);
  assert.equal(auth.getAccessToken(), "");
  assert.equal(expiredSessions, 1);
  assert.equal(protectedCalls, 0);
});

