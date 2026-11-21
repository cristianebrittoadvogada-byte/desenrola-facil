import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { buildInterestWhatsAppUrl, BUSINESS_WHATSAPP_NUMBER } from "../web/mentoria/lead-whatsapp.mjs";

const readPage = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("formulário prepara mensagem explícita para o WhatsApp comercial", () => {
  const url = new URL(buildInterestWhatsAppUrl({ name: "Pessoa Fictícia", phone: "(21) 99999-0000", email: "teste@example.invalid", focus: "vida financeira", goal: "Quero organizar minhas escolhas.", consent: true }));
  assert.equal(url.hostname, "wa.me");
  assert.equal(url.pathname, `/${BUSINESS_WHATSAPP_NUMBER}`);
  assert.match(url.searchParams.get("text"), /Pessoa Fictícia/);
  assert.match(url.searchParams.get("text"), /teste@example\.invalid/);
  assert.match(url.searchParams.get("text"), /vida financeira/);
  assert.match(url.searchParams.get("text"), /21\) 99999-0000/);
  assert.match(url.searchParams.get("text"), /Quero organizar minhas escolhas/);
  assert.match(url.searchParams.get("text"), /Origem: Página comercial da Mentoria Desenrola Fácil\./);
  assert.match(url.searchParams.get("text"), /Consentimento para retorno sobre a mentoria: SIM\./);
});

test("formulário não envia dados sem clique explícito da pessoa", async () => {
  const [html, script] = await Promise.all([readPage("../web/mentoria/index.html"), readPage("../web/mentoria/page.js")]);
  assert.match(html, /Seus dados não são enviados por esta página/);
  assert.match(html, /interest-consent/);
  assert.match(html, /interest-phone/);
  assert.match(html, /interest-goal/);
  assert.match(html, /whatsapp-continue/);
  assert.match(html, /id="prepare-message" type="button"/);
  assert.doesNotMatch(script, /fetch\(|XMLHttpRequest|sendBeacon/);
  assert.match(script, /lead_form_prepared/);
  assert.match(script, /whatsapp_cta_clicked/);
  assert.match(script, /lead_whatsapp_clicked/);
  assert.match(script, /cta_location/);
  assert.doesNotMatch(script, /sessionStorage\.setItem\([^,]+,[^\n]*(name|phone|goal|email)/i);
});

test("página mantém WhatsApp correto, consentimento e layout responsivo", async () => {
  const [html, css, script] = await Promise.all([
    readPage("../web/mentoria/index.html"), readPage("../web/mentoria/styles.css"), readPage("../web/mentoria/page.js"),
  ]);
  const links = [...html.matchAll(/href="(https:\/\/wa\.me\/[^\"]+)"/g)].map((match) => new URL(match[1]));
  assert.ok(links.length >= 2);
  for (const link of links) assert.equal(link.pathname, `/${BUSINESS_WHATSAPP_NUMBER}`);
  assert.match(html, /metodologia PPDD/i);
  assert.match(html, /Autorizo a equipe Desenrola Fácil/);
  assert.match(html, /interest-phone[^>]+type="tel"[^>]+inputmode="tel"/);
  assert.match(css, /@media\(max-width:520px\)/);
  assert.match(css, /--ink:#111/);
  assert.match(css, /--gold:#c7a45d/);
  assert.match(css, /\.interest-grid\{grid-template-columns:1fr/);
  assert.match(script, /setCustomValidity/);
});

test("mensagem exige nome e limita campos inseridos no WhatsApp", () => {
  assert.throws(() => buildInterestWhatsAppUrl({ name: "  ", phone: "21999999999", goal: "objetivo", consent: true }), /name_required/);
  assert.throws(() => buildInterestWhatsAppUrl({ name: "Pessoa", phone: "21", goal: "objetivo", consent: true }), /valid_whatsapp_required/);
  assert.throws(() => buildInterestWhatsAppUrl({ name: "Pessoa", phone: "21999999999", goal: "objetivo" }), /contact_consent_required/);
  const url = new URL(buildInterestWhatsAppUrl({ name: ` ${"A".repeat(200)} `, phone: "21999999999", focus: " x ".repeat(40), goal: "z".repeat(900), consent: true }));
  const text = url.searchParams.get("text");
  assert.ok(text.includes("A".repeat(160)));
  assert.ok(text.length < 1200);
});
