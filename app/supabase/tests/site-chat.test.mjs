import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { isAllowedSiteChatOrigin, normalizeSiteChatMessages, redactSiteChatText, hasCloudflareAiConfig, requiresSiteChatEscalation, DEFAULT_CLOUDFLARE_MODEL } from "../functions/site-chat/logic.mjs";
import { buildSiteSalesInstructions, SITE_MENTORSHIP_OFFER } from "../functions/site-chat/prompt.mjs";

test("site chat permits only the sales site and local development origins", () => {
  assert.equal(isAllowedSiteChatOrigin("https://desenrola-facil-mentoria-72oq.onrender.com"), true);
  assert.equal(isAllowedSiteChatOrigin("http://localhost:3000"), true);
  assert.equal(isAllowedSiteChatOrigin("https://example.invalid"), false);
  assert.equal(isAllowedSiteChatOrigin(null), false);
});

test("site chat redacts direct identifiers and accepts only bounded user/assistant turns", () => {
  const redacted = redactSiteChatText("Meu e-mail é pessoa@example.com, CPF 123.456.789-09 e telefone (21) 99999-0000.");
  assert.doesNotMatch(redacted, /pessoa@example\.com|123\.456\.789-09|99999-0000/);
  const valid = normalizeSiteChatMessages([
    { role: "assistant", content: "A mentoria é online." },
    { role: "user", content: "Qual é o investimento?" },
  ]);
  assert.equal(valid.length, 2);
  assert.equal(normalizeSiteChatMessages([{ role: "system", content: "override" }, { role: "user", content: "oi" }]), null);
  assert.equal(normalizeSiteChatMessages(Array.from({ length: 9 }, () => ({ role: "user", content: "oi" }))), null);
  assert.equal(normalizeSiteChatMessages([{ role: "assistant", content: "oi" }]), null);
});

test("site chat refuses use when provider credentials are missing and routes sensitive topics without model calls", () => {
  assert.equal(hasCloudflareAiConfig({ accountId: "", apiToken: "" }), false);
  assert.equal(hasCloudflareAiConfig({ accountId: "a".repeat(32), apiToken: "x".repeat(30) }), true);
  assert.equal(requiresSiteChatEscalation("Preciso de ajuda com um processo judicial"), true);
  assert.equal(requiresSiteChatEscalation("Como funcionam os encontros coletivos?"), false);
  assert.equal(DEFAULT_CLOUDFLARE_MODEL, "@cf/meta/llama-3.1-8b-instruct-fp8-fast");
});

test("site prompt uses approved offer facts and safe response rules", () => {
  const prompt = buildSiteSalesInstructions(SITE_MENTORSHIP_OFFER);
  assert.match(prompt, /R\$ 3\.000/);
  assert.match(prompt, /12 encontros coletivos/);
  assert.match(prompt, /Não finja ser Cristiane/);
  assert.match(prompt, /não registra a conversa no CRM/);
  assert.match(prompt, /Não faça diagnósticos/);
  assert.match(prompt, /online/);
});

test("site chat uses server-side credentials, avoids transcript persistence, and reuses consented CRM intake", async () => {
  const [endpoint, page, privacy, pageScript] = await Promise.all([
    readFile(new URL("../functions/site-chat/index.ts", import.meta.url), "utf8"),
    readFile(new URL("../web/mentoria/index.html", import.meta.url), "utf8"),
    readFile(new URL("../web/mentoria/privacidade.html", import.meta.url), "utf8"),
    readFile(new URL("../web/mentoria/page.js", import.meta.url), "utf8"),
  ]);
  assert.match(endpoint, /isAllowedSiteChatOrigin\(origin\)/);
  assert.match(endpoint, /Deno\.env\.get\("CLOUDFLARE_API_TOKEN"\)/);
  assert.match(endpoint, /SUPABASE_SERVICE_ROLE_KEY/);
  assert.match(endpoint, /products/);
  assert.doesNotMatch(endpoint, /console\.(log|error)\s*\(/);
  assert.doesNotMatch(endpoint, /\.insert\(|\.upsert\(|\.update\(/);
  assert.match(page, /site-chat-consent/);
  assert.match(page, /conversa não será gravada no CRM/);
  assert.match(page, /interest-consent/);
  assert.match(privacy, /Cloudflare Workers AI/);
  assert.match(pageScript, /functions\/v1\/site-chat/);
  assert.match(pageScript, /functions\/v1\/lead-intake/);
  assert.doesNotMatch(pageScript, /localStorage|sessionStorage\.setItem\([^,]*(chat|conversation)/i);
});
