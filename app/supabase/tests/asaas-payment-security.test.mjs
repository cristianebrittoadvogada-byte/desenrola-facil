import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { asaasCustomerPayload, asaasPaymentPayload, asaasRequest, isTrustedAsaasCheckoutUrl } from "../functions/payments/asaas.mjs";
import { normalizeAsaasEvent, reconcileAsaasPayment, verifyAsaasWebhookToken } from "../functions/asaas-webhook/security.mjs";

test("checkout sempre chama somente o endpoint Sandbox e identifica o cliente HTTP", async () => {
  let requested = "";
  const result = await asaasRequest("/payments", "sandbox-test-key", { method: "POST", body: { externalReference: "sale-test" } }, async (url, options) => {
    requested = url;
    assert.equal(options.headers["user-agent"], "DesenrolaFacil/1.0");
    return new Response(JSON.stringify({ id: "pay_test" }), { status: 200 });
  });
  assert.equal(result.ok, true);
  assert.equal(requested, "https://api-sandbox.asaas.com/v3/payments");
});

test("link de checkout só pode usar HTTPS em domínio oficial Asaas", () => {
  assert.equal(isTrustedAsaasCheckoutUrl("https://www.asaas.com/i/test"), true);
  assert.equal(isTrustedAsaasCheckoutUrl("https://asaas.com.evil.test/i/test"), false);
  assert.equal(isTrustedAsaasCheckoutUrl("http://asaas.com/i/test"), false);
});

test("dados fiscais são transmitidos no cadastro do provedor sem campos de persistência", () => {
  const customer = asaasCustomerPayload({ fullName: "Cliente Fictício", cpfCnpj: "52998224725", email: null, phone: null, contactId: "contact-test" });
  assert.equal(customer.cpfCnpj, "52998224725");
  assert.equal(customer.notificationDisabled, true);
  assert.equal("access_token" in customer, false);
  assert.equal("raw_payload" in customer, false);
});

test("parcelamento só é incluído para crédito parcelado", () => {
  const pix = asaasPaymentPayload({ customerId: "cus_test", amount: 3000, saleId: "sale-test", productName: "Mentoria", billingType: "PIX", installments: 6, dueDate: "2026-11-22" });
  const card = asaasPaymentPayload({ customerId: "cus_test", amount: 3000, saleId: "sale-test", productName: "Mentoria", billingType: "CREDIT_CARD", installments: 3, dueDate: "2026-11-22" });
  assert.equal("installmentCount" in pix, false);
  assert.equal(card.installmentCount, 3);
  assert.equal(card.totalValue, 3000);
});

test("webhook Asaas usa token dedicado forte e normaliza somente identificadores", () => {
  const token = "x".repeat(40);
  assert.equal(verifyAsaasWebhookToken(token, token), true);
  assert.equal(verifyAsaasWebhookToken(token, "api-key"), false);
  assert.equal(verifyAsaasWebhookToken("x".repeat(39), token), false);
  assert.equal(verifyAsaasWebhookToken("x".repeat(256), "x".repeat(256)), false);
  assert.deepEqual(normalizeAsaasEvent({ id: "evt_fake", event: "PAYMENT_RECEIVED", payment: { id: "pay_fake", value: 3000 } }), {
    id: "evt_fake", event: "PAYMENT_RECEIVED", paymentId: "pay_fake",
  });
  assert.equal(normalizeAsaasEvent({ id: "evt_fake", event: "PAYMENT_RECEIVED" }), null);
});

test("confirma a venda sem caixa disponível até PAYMENT_RECEIVED", () => {
  const session = { sale_id: "sale-fake", external_charge_id: "pay-fake", amount: 3000 };
  const confirmed = reconcileAsaasPayment({
    event: "PAYMENT_CONFIRMED", session,
    payment: { id: "pay-fake", externalReference: "sale-fake", value: 3000, status: "CONFIRMED" },
  });
  const received = reconcileAsaasPayment({
    event: "PAYMENT_RECEIVED", session,
    payment: { id: "pay-fake", externalReference: "sale-fake", value: 3000, status: "RECEIVED" },
  });
  assert.deepEqual(confirmed, { action: "confirm_sale", fundsAvailable: false, sessionStatus: "confirmed" });
  assert.deepEqual(received, { action: "confirm_sale", fundsAvailable: true, sessionStatus: "confirmed" });
});

test("checkout Sandbox permite CORS somente no painel previsto e pode ser ajustado por segredo", async () => {
  const source = await readFile(new URL("../functions/payments/index.ts", import.meta.url), "utf8");
  assert.match(source, /Deno\.env\.get\("WEB_ORIGIN"\) \?\? "http:\/\/localhost:3000,http:\/\/127\.0\.0\.1:3000,https:\/\/desenrola-facil-painel\.onrender\.com"/);
});

test("webhook ignora evento com venda, cobrança ou valor divergente", () => {
  const session = { sale_id: "sale-fake", external_charge_id: "pay-fake", amount: 3000 };
  assert.equal(reconcileAsaasPayment({ event: "PAYMENT_RECEIVED", session, payment: { id: "another", externalReference: "sale-fake", value: 3000, status: "RECEIVED" } }).reason, "charge_mismatch");
  assert.equal(reconcileAsaasPayment({ event: "PAYMENT_RECEIVED", session, payment: { id: "pay-fake", externalReference: "another", value: 3000, status: "RECEIVED" } }).reason, "sale_reference_mismatch");
  assert.equal(reconcileAsaasPayment({ event: "PAYMENT_RECEIVED", session, payment: { id: "pay-fake", externalReference: "sale-fake", value: 2, status: "RECEIVED" } }).reason, "amount_mismatch");
});
