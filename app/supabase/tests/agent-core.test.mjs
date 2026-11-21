import test from "node:test";
import assert from "node:assert/strict";
import { canSendAutomatedMessage, decideSalesReply, messageFingerprintParts, nextFollowUpAt } from "../functions/agent/core.mjs";
import { buildInterestWhatsAppUrl } from "../web/mentoria/lead-whatsapp.mjs";

const offers = [
  { code: "mentoria-desenrola-facil", name: "MENTORIA DESENROLA FÁCIL", category: "mentoria", price: 3000, currency: "BRL", format: "individual e coletivo", duration_text: "3 meses", delivery_mode: "online" },
  { code: "livro-desenrola-facil", name: "LIVRO", category: "livro", price: 69.9, currency: "BRL", format: "produto editorial", delivery_mode: "editorial" },
];

test("motor comercial responde com preço e condições existentes no catálogo", () => {
  const result = decideSalesReply({ text: "Quero saber sobre a mentoria", offers });
  assert.equal(result.action, "reply");
  assert.equal(result.intent, "offer_interest");
  assert.equal(result.productCode, "mentoria-desenrola-facil");
  assert.match(result.reply, /R\$\s*3\.000,00/);
  assert.match(result.reply, /3 meses/);
});

test("mensagem preparada pela página qualifica a mentoria no motor do funil", () => {
  const url = new URL(buildInterestWhatsAppUrl({
    name: "Lia Teste", phone: "21999990000", focus: "formato e investimento",
    goal: "Quero conhecer a metodologia.", consent: true,
  }));
  const decision = decideSalesReply({ text: url.searchParams.get("text"), offers });
  assert.equal(decision.intent, "offer_interest");
  assert.equal(decision.productCode, "mentoria-desenrola-facil");
  assert.match(decision.reply, /R\$\s*3\.000,00/);
});

test("motor não inventa uma oferta quando catálogo está vazio", () => {
  const result = decideSalesReply({ text: "Qual o preço?", offers: [] });
  assert.equal(result.intent, "offer_list");
  assert.match(result.reply, /equipe confirmar/);
});

test("pedido de pessoa e assunto delicado param automação e pedem handoff", () => {
  const result = decideSalesReply({ text: "Quero falar com uma pessoa sobre uma crise", offers });
  assert.equal(result.action, "handoff");
  assert.equal(result.intent, "human_requested");
});

test("thread em atendimento humano nunca recebe resposta automática", () => {
  assert.deepEqual(decideSalesReply({ text: "oi", offers, controlState: "human_assigned" }), {
    action: "none", reason: "thread_not_automated",
  });
  assert.equal(canSendAutomatedMessage({ controlState: "human_requested", providerAllowsReply: true }), false);
});

test("envio exige política do provedor e opt-in em mensagens de marketing", () => {
  assert.equal(canSendAutomatedMessage({ controlState: "automation", providerAllowsReply: false }), false);
  assert.equal(canSendAutomatedMessage({ controlState: "automation", providerAllowsReply: true, marketing: true, marketingConsent: false }), false);
  assert.equal(canSendAutomatedMessage({ controlState: "automation", providerAllowsReply: true, marketing: true, marketingConsent: true }), true);
});

test("identidade externa de evento aceita somente canais oficiais suportados", () => {
  assert.deepEqual(messageFingerprintParts({ channel: "whatsapp", accountId: "test-account", externalMessageId: "test-message" }), {
    channel: "whatsapp", providerAccountId: "test-account", externalEventId: "test-message",
  });
  assert.throws(() => messageFingerprintParts({ channel: "whatsapp-web", accountId: "x", externalMessageId: "y" }));
});

test("follow-up vencido é reagendado; data futura continua respeitada", () => {
  const now = Date.parse("2026-11-20T12:00:00.000Z");
  assert.equal(nextFollowUpAt("2026-11-20T11:00:00.000Z", now), "2026-11-21T11:00:00.000Z");
  assert.equal(nextFollowUpAt("2026-11-22T12:00:00.000Z", now), "2026-11-22T12:00:00.000Z");
  assert.equal(nextFollowUpAt(null, now), "2026-11-21T11:00:00.000Z");
});
