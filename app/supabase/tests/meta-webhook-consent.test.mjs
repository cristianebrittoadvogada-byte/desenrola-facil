import test from "node:test";
import assert from "node:assert/strict";
import { hasExplicitMentorshipServiceConsent, normalizeMetaWebhook } from "../functions/meta-webhook/normalize.mjs";
import { recordExplicitServiceConsent } from "../functions/meta-webhook/consent.mjs";

test("reconhece apenas a declaração explícita de contato de serviço", () => {
  assert.equal(hasExplicitMentorshipServiceConsent("Quero conhecer a mentoria.\nConsentimento para retorno sobre a mentoria: SIM."), true);
  assert.equal(hasExplicitMentorshipServiceConsent("consentimento para retorno sobre a mentoria: sim"), true);
  assert.equal(hasExplicitMentorshipServiceConsent("Quero receber novidades e marketing."), false);
  assert.equal(hasExplicitMentorshipServiceConsent("Consentimento para retorno sobre a mentoria: NÃO."), false);
  assert.equal(hasExplicitMentorshipServiceConsent(null), false);
});

test("reconhece origem da página comercial para atribuição no CRM", () => {
  const [event] = normalizeMetaWebhook({
    object: "whatsapp_business_account",
    entry: [{ id: "fictional-account", changes: [{ field: "messages", value: {
      metadata: { phone_number_id: "fictional-phone-id" },
      messages: [{ id: "fictional-message-id", from: "5521999999999", timestamp: "1795214400", type: "text", text: {
        body: "Olá, quero conversar sobre a Mentoria Desenrola Fácil®.\nOrigem: Página comercial da Mentoria Desenrola Fácil.\nConsentimento para retorno sobre a mentoria: SIM.",
      } }],
    } }] }],
  });
  assert.equal(event.campaignSource, "mentoria_landing_page");
  assert.equal(event.serviceContactConsent, true);
});

test("grava consentimento de serviço somente para mensagem WhatsApp explícita", async () => {
  const inserted = [];
  const database = { from: (table) => ({ insert: async (row) => { inserted.push({ table, row }); return { error: null }; } }) };
  const event = {
    channel: "whatsapp", serviceContactConsent: true, accountId: "fictional-account",
    externalId: "fictional-message", receivedAt: "2026-11-20T12:00:00.000Z",
  };
  const result = await recordExplicitServiceConsent(database, { contactId: "fictional-contact", event });
  assert.deepEqual(result, { recorded: true, duplicate: false });
  assert.equal(inserted.length, 1);
  assert.equal(inserted[0].table, "communication_consents");
  assert.deepEqual(inserted[0].row, {
    contact_id: "fictional-contact", channel: "whatsapp", purpose: "service", state: "granted",
    source: "whatsapp_message_explicit_service_consent",
    evidence_reference: "fictional-account:fictional-message", occurred_at: "2026-11-20T12:00:00.000Z",
  });
  assert.equal(inserted[0].row.purpose, "service");
});

test("não registra mensagens sem consentimento, de Instagram ou evento duplicado", async () => {
  let writes = 0;
  const database = { from: () => ({ insert: async () => { writes += 1; return { error: { code: "23505" } }; } }) };
  const noConsent = await recordExplicitServiceConsent(database, { contactId: "fictional", event: { channel: "whatsapp", serviceContactConsent: false } });
  const instagram = await recordExplicitServiceConsent(database, { contactId: "fictional", event: { channel: "instagram", serviceContactConsent: true } });
  const duplicate = await recordExplicitServiceConsent(database, { contactId: "fictional", event: { channel: "whatsapp", serviceContactConsent: true, accountId: "account", externalId: "message" } });
  assert.deepEqual(noConsent, { recorded: false, duplicate: false });
  assert.deepEqual(instagram, { recorded: false, duplicate: false });
  assert.deepEqual(duplicate, { recorded: false, duplicate: true });
  assert.equal(writes, 1);
});
