const ALLOWED_ORIGINS = new Set([
  "https://desenrola-facil-mentoria-72oq.onrender.com",
  "http://localhost:3000",
  "http://127.0.0.1:3000",
]);

const EMAIL = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const PHONE = /(?:\+?55\s*)?(?:\(?\d{2}\)?\s*)?9?\d{4}[-.\s]?\d{4}\b/g;
const CPF = /\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g;
export const DEFAULT_CLOUDFLARE_MODEL = "@cf/meta/llama-3.1-8b-instruct-fp8-fast";

export function isAllowedSiteChatOrigin(origin) {
  return typeof origin === "string" && ALLOWED_ORIGINS.has(origin);
}

export function redactSiteChatText(value) {
  return String(value ?? "")
    .replace(EMAIL, "[e-mail removido]")
    .replace(CPF, "[documento removido]")
    .replace(PHONE, "[telefone removido]")
    .slice(0, 1200);
}

export function normalizeSiteChatMessages(value) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 8) return null;
  const messages = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object" || !["user", "assistant"].includes(entry.role)) return null;
    if (typeof entry.content !== "string" || !entry.content.trim() || entry.content.length > 2000) return null;
    messages.push({ role: entry.role, content: redactSiteChatText(entry.content) });
  }
  if (messages.at(-1)?.role !== "user") return null;
  return messages;
}

export function hasCloudflareAiConfig({ accountId, apiToken }) {
  return typeof accountId === "string" && /^[a-f0-9]{32}$/i.test(accountId)
    && typeof apiToken === "string" && apiToken.length >= 20 && apiToken.length <= 512;
}

export function requiresSiteChatEscalation(value) {
  const text = String(value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  return /\b(suicid|me machucar|automutil|violencia|abuso|processo judicial|meu caso juridico|crise emocional)\b/.test(text);
}
