import test from "node:test";
import assert from "node:assert/strict";
import { normalizeMetaWebhook } from "../functions/meta-webhook/normalize.mjs";

test("normaliza mensagem WhatsApp sem preservar payload bruto", () => {
  const events = normalizeMetaWebhook({
    object: "whatsapp_business_account",
    entry: [{ id: "waba-test", changes: [{ field: "messages", value: {
      metadata: { phone_number_id: "phone-test" },
      contacts: [{ wa_id: "5521999999999", profile: { name: "Pessoa Fictícia" } }],
      messages: [{ id: "wamid.test", from: "5521999999999", timestamp: "1795132800", type: "text", text: { body: "Quero conhecer a mentoria" } }],
    } }] }],
  });
  assert.equal(events.length, 1);
  assert.equal(events[0].provider, "whatsapp_cloud");
  assert.equal(events[0].accountId, "phone-test");
  assert.equal(events[0].displayName, "Pessoa Fictícia");
  assert.equal(events[0].text, "Quero conhecer a mentoria");
  assert.equal(events[0].requiresHuman, false);
  assert.equal("rawPayload" in events[0], false);
});

test("normaliza atualizações de entrega do WhatsApp para o histórico", () => {
  const events = normalizeMetaWebhook({
    object: "whatsapp_business_account",
    entry: [{ id: "waba-test", changes: [{ field: "messages", value: {
      metadata: { phone_number_id: "phone-test" },
      statuses: [{ id: "wamid.outbound.test", status: "read", timestamp: "1795132800" }],
    } }] }],
  });
  assert.equal(events.length, 1);
  assert.equal(events[0].eventType, "message.status.read");
  assert.equal(events[0].messageId, "wamid.outbound.test");
  assert.equal(events[0].deliveryStatus, "read");
});

test("normaliza mensagem Instagram e ignora eco enviado pela própria conta", () => {
  const events = normalizeMetaWebhook({
    object: "instagram",
    entry: [{ id: "ig-business-test", messaging: [
      { sender: { id: "ig-user-test" }, recipient: { id: "ig-business-test" }, timestamp: 1795132800000, message: { mid: "ig.mid.test", text: "Olá" } },
      { sender: { id: "ig-business-test" }, recipient: { id: "ig-user-test" }, timestamp: 1795132800000, message: { mid: "ig.echo.test", text: "Olá", is_echo: true } },
    ] }],
  });
  assert.equal(events.length, 1);
  assert.equal(events[0].channel, "instagram");
  assert.equal(events[0].senderId, "ig-user-test");
  assert.equal(events[0].text, "Olá");
  assert.equal(events[0].receivedAt, "2026-11-20T00:00:00.000Z");
});

test("normaliza eventos de Conversation Routing para não disputar o controle", () => {
  const events = normalizeMetaWebhook({
    object: "instagram",
    entry: [{ id: "ig-business-test", messaging: [{
      sender: { id: "ig-business-test" }, recipient: { id: "ig-user-test" }, timestamp: 1795132800000,
      pass_thread_control: { new_owner_app_id: "other-app" },
    }] }],
  });
  assert.equal(events.length, 1);
  assert.equal(events[0].controlAction, "passed");
  assert.equal(events[0].conversationId, "ig-user-test");
  assert.equal(events[0].eventType, "thread.passed_control");
});

test("handoff_reason Instagram previsto pela Meta encaminha para atendimento humano", () => {
  const [event] = normalizeMetaWebhook({
    object: "instagram",
    entry: [{ id: "ig-business-test", messaging: [{
      sender: { id: "ig-user-test" }, timestamp: 1795132800000,
      message: { mid: "ig.handoff.test", text: "Quero concluir a compra", handoff_reason: "purchase_intent" },
    }] }],
  });
  assert.equal(event.handoffReason, "purchase_intent");
  assert.equal(event.requiresHuman, true);
});

test("valores de handoff fora da lista oficial não são persistidos", () => {
  const [event] = normalizeMetaWebhook({
    object: "instagram",
    entry: [{ id: "ig-business-test", messaging: [{
      sender: { id: "ig-user-test" }, timestamp: 1795132800000,
      message: { mid: "ig.handoff.unknown.test", text: "Olá", handoff_reason: "texto arbitrário" },
    }] }],
  });
  assert.equal(event.handoffReason, null);
  assert.equal(event.requiresHuman, false);
});

test("mensagem com mídia sem texto encaminha para pessoa", () => {
  const events = normalizeMetaWebhook({
    object: "instagram",
    entry: [{ id: "ig-business-test", messaging: [{
      sender: { id: "ig-user-test" }, timestamp: 1795132800000,
      message: { mid: "ig.image.test", attachments: [{ type: "image" }] },
    }] }],
  });
  assert.equal(events[0].text, null);
  assert.equal(events[0].requiresHuman, true);
});

test("texto WhatsApp ausente é tratado como formato não suportado sem interromper o webhook", () => {
  const events = normalizeMetaWebhook({
    object: "whatsapp_business_account",
    entry: [{ id: "waba-test", changes: [{ field: "messages", value: {
      metadata: { phone_number_id: "phone-test" },
      messages: [{ id: "wamid.malformed", from: "user-test", timestamp: "1795132800", type: "text" }],
    } }] }],
  });
  assert.equal(events.length, 1);
  assert.equal(events[0].text, null);
  assert.equal(events[0].eventType, "message.unsupported");
  assert.equal(events[0].requiresHuman, true);
});

test("desconhece objetos Meta sem criar mensagens", () => {
  assert.deepEqual(normalizeMetaWebhook({ object: "page", entry: [] }), []);
  assert.deepEqual(normalizeMetaWebhook(null), []);
});
