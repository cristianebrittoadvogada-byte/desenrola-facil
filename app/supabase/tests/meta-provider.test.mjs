import test from "node:test";
import assert from "node:assert/strict";
import { sendMetaTextMessage } from "../functions/meta-webhook/provider.mjs";

test("WhatsApp usa somente Cloud API oficial e token em header", async () => {
  let captured;
  const result = await sendMetaTextMessage({
    channel: "whatsapp", recipientId: "5521999999999", text: "Resposta de teste",
    env: { META_GRAPH_VERSION: "v27.0", WHATSAPP_PHONE_NUMBER_ID: "123456", WHATSAPP_ACCESS_TOKEN: "fake-token-for-test" },
    fetchImpl: async (url, options) => {
      captured = { url, options };
      return new Response(JSON.stringify({ messages: [{ id: "wamid.fake" }] }), { status: 200 });
    },
  });
  assert.equal(result.ok, true);
  assert.equal(captured.url, "https://graph.facebook.com/v27.0/123456/messages");
  assert.equal(captured.options.headers.Authorization, "Bearer fake-token-for-test");
  assert.equal(JSON.parse(captured.options.body).messaging_product, "whatsapp");
});

test("Instagram usa Instagram Login API e limite documentado de bytes", async () => {
  let capturedUrl = "";
  const result = await sendMetaTextMessage({
    channel: "instagram", recipientId: "ig-user-test", text: "Olá",
    env: { META_GRAPH_VERSION: "v27.0", INSTAGRAM_ACCOUNT_ID: "78910", INSTAGRAM_ACCESS_TOKEN: "fake-token-for-test" },
    fetchImpl: async (url) => {
      capturedUrl = url;
      return new Response(JSON.stringify({ message_id: "ig.mid.fake" }), { status: 200 });
    },
  });
  assert.equal(result.ok, true);
  assert.equal(capturedUrl, "https://graph.instagram.com/v27.0/78910/messages");

  const tooLong = await sendMetaTextMessage({
    channel: "instagram", recipientId: "ig-user-test", text: "é".repeat(501),
    env: { META_GRAPH_VERSION: "v27.0", INSTAGRAM_ACCOUNT_ID: "78910", INSTAGRAM_ACCESS_TOKEN: "fake-token-for-test" },
    fetchImpl: async () => { throw new Error("must not reach provider"); },
  });
  assert.deepEqual(tooLong, { ok: false, code: "instagram_message_too_long" });
});

test("sem segredo ou versão não realiza chamada externa", async () => {
  const result = await sendMetaTextMessage({
    channel: "whatsapp", recipientId: "5521999999999", text: "Teste", env: {},
    fetchImpl: async () => { throw new Error("must not reach provider"); },
  });
  assert.equal(result.code, "graph_version_not_configured");
});
