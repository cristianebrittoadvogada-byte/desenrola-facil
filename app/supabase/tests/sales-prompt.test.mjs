import test from "node:test";
import assert from "node:assert/strict";
import { buildApprovedSalesPrompt } from "../functions/agent/sales-prompt.mjs";

test("prompt comercial usa a oferta aprovada e corrige dados antigos da mentoria", () => {
  const prompt = buildApprovedSalesPrompt([{
    code: "mentoria-desenrola-facil",
    name: "Mentoria Desenrola Fácil",
    category: "mentoria",
    description: "Oferta antiga",
    price: 3000,
    currency: "BRL",
    format: "híbrido",
    duration_text: "3 meses",
    delivery_mode: "individual e coletivo",
  }]);

  assert.match(prompt, /100% online/);
  assert.match(prompt, /12 encontros coletivos e uma conversa individual inicial/);
  assert.match(prompt, /R\$ 3\.000/);
  assert.doesNotMatch(prompt, /Oferta antiga|híbrido|individual e coletivo/);
  assert.match(prompt, /nenhum emoji/);
  assert.match(prompt, /não substitui acompanhamento profissional/);
  assert.match(prompt, /assistente da equipe/);
});

test("prompt injeta uma oferta aprovada mesmo se o catálogo estiver vazio", () => {
  const prompt = buildApprovedSalesPrompt([]);
  assert.match(prompt, /Mentoria Desenrola Fácil/);
  assert.match(prompt, /https:\/\/loja\.infinitepay\.io\/cristiane-britto-rra/);
});

test("prompt limita texto livre de outros itens do catálogo", () => {
  const prompt = buildApprovedSalesPrompt([{
    code: "livro",
    name: "Livro",
    category: "livro",
    description: "x".repeat(1200),
  }]);
  assert.ok(prompt.length < 7000);
  assert.doesNotMatch(prompt, /x{801}/);
});

