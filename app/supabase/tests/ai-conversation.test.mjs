import test from "node:test";
import assert from "node:assert/strict";
import { buildSalesInput, buildSalesInstructions, generateContextualSalesReply, redactConversationText } from "../functions/agent/ai.mjs";

test("redacts direct identifiers before conversation text leaves the backend", () => {
  const redacted = redactConversationText("Meu e-mail é teste@example.com e meu número é +55 21 99999-0000.");
  assert.doesNotMatch(redacted, /teste@example\.com|99999-0000/);
  assert.match(redacted, /e-mail removido/);
  assert.match(redacted, /telefone removido/);
});

test("AI request uses recent conversation memory and current catalog facts", async () => {
  let requestBody;
  const result = await generateContextualSalesReply({
    apiKey: "x".repeat(32),
    offers: [{ code: "MENTORIA", name: "Mentoria Desenrola Fácil", price: 3000, duration_text: "3 meses" }],
    history: [{ direction: "inbound", body: "Estou pensando há algumas semanas." }, { direction: "outbound", body: "O que pesa mais nessa decisão?" }],
    currentText: "Quero saber como funciona.",
    fetchImpl: async (url, init) => {
      assert.equal(url, "https://api.openai.com/v1/responses");
      requestBody = JSON.parse(init.body);
      return new Response(JSON.stringify({ output_text: "Posso explicar. O que você gostaria de entender primeiro?" }), { status: 200 });
    },
  });
  assert.equal(result.ok, true);
  assert.match(result.reply, /explicar/);
  assert.equal(requestBody.store, false);
  assert.equal(requestBody.input.length, 3);
  assert.match(requestBody.instructions, /3000/);
  assert.match(requestBody.instructions, /PPDD/);
});

test("AI fails closed without a key and does not make a network request", async () => {
  const result = await generateContextualSalesReply({ apiKey: "", currentText: "Oi", fetchImpl: () => { throw new Error("must_not_call"); } });
  assert.deepEqual(result, { ok: false, code: "ai_provider_not_configured" });
});

test("conversation roles preserve inbound/outbound context and redact contact details", () => {
  const input = buildSalesInput({
    history: [{ direction: "inbound", body: "Meu telefone é +55 21 99999-0000" }, { direction: "outbound", body: "Entendi." }],
    currentText: "E-mail: pessoa@example.com",
  });
  assert.deepEqual(input.map((item) => item.role), ["user", "assistant", "user"]);
  assert.doesNotMatch(JSON.stringify(input), /99999-0000|pessoa@example\.com/);
});

test("system instructions keep the offer catalog as the only source of commercial facts", () => {
  const prompt = buildSalesInstructions([{ code: "A", name: "Oferta segura", price: 123 }]);
  assert.match(prompt, /Não invente preço/);
  assert.match(prompt, /Oferta segura/);
  assert.match(prompt, /não prometa resultados/);
});

