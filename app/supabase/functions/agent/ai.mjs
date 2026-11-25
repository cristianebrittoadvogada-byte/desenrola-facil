const EMAIL = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const PHONE = /(?:\+?55\s*)?(?:\(?\d{2}\)?\s*)?9?\d{4}[-.\s]?\d{4}\b/g;
const CPF = /\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g;

import { buildApprovedSalesPrompt } from "./sales-prompt.mjs";

export const DEFAULT_SALES_MODEL = "gpt-4.1-mini";

export function redactConversationText(value) {
  return String(value ?? "")
    .replace(EMAIL, "[e-mail removido]")
    .replace(CPF, "[documento removido]")
    .replace(PHONE, "[telefone removido]")
    .slice(0, 1800);
}

export const buildSalesInstructions = buildApprovedSalesPrompt;

export function buildSalesInput({ history = [], currentText }) {
  const rows = (Array.isArray(history) ? history : []).slice(-8).map((item) => ({
    role: item.direction === "outbound" ? "assistant" : "user",
    content: [{ type: "input_text", text: redactConversationText(item.body) }],
  })).filter((item) => item.content[0].text.trim());
  rows.push({ role: "user", content: [{ type: "input_text", text: redactConversationText(currentText) }] });
  return rows;
}

export async function generateContextualSalesReply({ apiKey, model = DEFAULT_SALES_MODEL, offers, history, currentText, fetchImpl = fetch }) {
  if (typeof apiKey !== "string" || apiKey.length < 20) return { ok: false, code: "ai_provider_not_configured" };
  const normalizedModel = /^[a-zA-Z0-9._-]{1,80}$/.test(model) ? model : DEFAULT_SALES_MODEL;
  let response;
  try {
    response = await fetchImpl("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: normalizedModel,
        instructions: buildSalesInstructions(offers),
        input: buildSalesInput({ history, currentText }),
        max_output_tokens: 260,
        store: false,
      }),
      signal: AbortSignal.timeout(10000),
    });
  } catch {
    return { ok: false, code: "ai_provider_unreachable" };
  }
  if (!response.ok) return { ok: false, code: `ai_provider_http_${response.status}` };
  let body;
  try { body = await response.json(); } catch { return { ok: false, code: "ai_response_invalid" }; }
  const output = typeof body.output_text === "string" ? body.output_text
    : (body.output ?? []).flatMap((item) => item.content ?? []).filter((item) => item.type === "output_text").map((item) => item.text).join("\n");
  const reply = String(output ?? "").trim();
  if (!reply || reply.length > 3000) return { ok: false, code: "ai_response_invalid" };
  return { ok: true, reply };
}

