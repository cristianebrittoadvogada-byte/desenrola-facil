import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { isAllowedOrigin, normalizePhone, responseBody, validateLeadPayload } from "../functions/lead-intake/validation.mjs";

const validPayload = {
  request_id: "f79d7d2f-29a5-4e20-9caa-5c7cba6e3fb4",
  name: "Lead QA Fictício",
  phone: "(21) 99999-1111",
  email: "lead-teste@example.invalid",
  source: "instagram_bio",
  contact_consent: true,
  goal: "Esse texto não deve ir para o CRM.",
};

test("captura aceita apenas a origem comercial e localhost de desenvolvimento", () => {
  assert.equal(isAllowedOrigin("https://desenrola-facil-mentoria-72oq.onrender.com"), true);
  assert.equal(isAllowedOrigin("http://localhost:3000"), true);
  assert.equal(isAllowedOrigin("https://evil.example"), false);
  assert.equal(isAllowedOrigin(null), false);
});

test("normaliza DDD brasileiro e telefones internacionais sem guardar formatação", () => {
  assert.equal(normalizePhone("(21) 99999-1111"), "5521999991111");
  assert.equal(normalizePhone("+1 (212) 555-0100"), "12125550100");
  assert.equal(normalizePhone("123"), null);
});

test("respostas sem conteúdo não tentam serializar body para status 204 ou 304", () => {
  assert.equal(responseBody({ ok: true }, 204), null);
  assert.equal(responseBody({ ok: true }, 304), null);
  assert.equal(responseBody({ accepted: true }, 200), JSON.stringify({ accepted: true }));
});

test("captura mantém somente os campos aprovados e exclui objetivo livre", () => {
  const result = validateLeadPayload(validPayload);
  assert.equal(result.ok, true);
  assert.deepEqual(result.value, {
    requestId: validPayload.request_id,
    name: validPayload.name,
    phone: "5521999991111",
    email: "lead-teste@example.invalid",
    source: "instagram_bio",
    consent: true,
  });
  assert.equal("goal" in result.value, false);
});

test("captura rejeita consentimento ausente, fonte não aprovada e dados inválidos", () => {
  assert.equal(validateLeadPayload({ ...validPayload, contact_consent: false }).code, "contact_consent_required");
  assert.equal(validateLeadPayload({ ...validPayload, source: "imported" }).code, "invalid_source");
  assert.equal(validateLeadPayload({ ...validPayload, phone: "abc" }).code, "invalid_phone");
  assert.equal(validateLeadPayload({ ...validPayload, email: "bad-email" }).code, "invalid_email");
  assert.equal(validateLeadPayload({ ...validPayload, company_website: "spam" }).code, "honeypot");
});

test("migração é aditiva e RPC não é executável por anon ou authenticated", async () => {
  const sql = await readFile(new URL("../migrations/20261121140000_public_mentoria_leads.sql", import.meta.url), "utf8");
  assert.doesNotMatch(sql, /\b(drop|truncate|delete\s+from)\b/i);
  assert.match(sql, /enable row level security/i);
  assert.match(sql, /revoke all on function public\.capture_public_mentoria_lead[\s\S]*from public, anon, authenticated/i);
  assert.match(sql, /grant execute on function public\.capture_public_mentoria_lead[\s\S]*to service_role/i);
  assert.match(sql, /marketing_consent\)\s*values[\s\S]*false/i);
});

test("migração de oferta altera apenas a modalidade aprovada da mentoria", async () => {
  const sql = await readFile(new URL("../migrations/20261121191746_align_mentoria_offer_hybrid.sql", import.meta.url), "utf8");
  assert.match(sql, /set delivery_mode = 'hibrido'/i);
  assert.match(sql, /code = 'mentoria-desenrola-facil'/i);
  assert.match(sql, /updated_rows <> 1/i);
  assert.doesNotMatch(sql, /\b(drop|truncate|delete\s+from)\b/i);
  assert.doesNotMatch(sql, /set\s+price\s*=/i);
});

test("Edge Function mantém validação server-side e não registra conteúdo pessoal em log", async () => {
  const source = await readFile(new URL("../functions/lead-intake/index.ts", import.meta.url), "utf8");
  assert.match(source, /isAllowedOrigin\(origin\)/);
  assert.match(source, /consumeRateLimit\(key\)/);
  assert.match(source, /capture_public_mentoria_lead/);
  assert.match(source, /responseBody\(body, status\)/);
  assert.doesNotMatch(source, /console\.(log|error)\s*\(/);
  assert.doesNotMatch(source, /company_website|goal/);
});

test("página salva antes de liberar WhatsApp e registra evento sem dados pessoais", async () => {
  const script = await readFile(new URL("../web/mentoria/page.js", import.meta.url), "utf8");
  const savePosition = script.indexOf("await fetch(intakeUrl");
  const waPosition = script.indexOf("continueLink.href = buildInterestWhatsAppUrl");
  assert.ok(savePosition >= 0 && waPosition > savePosition);
  assert.match(script, /lead_saved_to_crm/);
  const conversionRecorder = script.match(/function recordConversion\([\s\S]*?\n}/)?.[0] ?? "";
  assert.ok(conversionRecorder);
  assert.doesNotMatch(conversionRecorder, /\b(name|phone|email|goal)\s*:/i);
});

