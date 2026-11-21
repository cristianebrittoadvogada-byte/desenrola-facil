const allowedOrigins = new Set([
  "https://desenrola-facil-mentoria-72oq.onrender.com",
  "http://localhost:3000",
  "http://127.0.0.1:3000",
]);
const allowedSources = new Set([
  "website:mentoria_sales_page",
  "instagram_bio",
  "linktree",
]);

export function isAllowedOrigin(origin) {
  return typeof origin === "string" && allowedOrigins.has(origin);
}

export function normalizePhone(value) {
  const raw = String(value ?? "").trim();
  const digits = raw.replace(/\D/g, "");
  if (raw.startsWith("+") && digits.length >= 11 && digits.length <= 15) return digits;
  if (digits.length === 10 || digits.length === 11) return `55${digits}`;
  return digits.length >= 12 && digits.length <= 15 ? digits : null;
}

export function validateLeadPayload(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return { ok: false, code: "invalid_payload" };
  if (String(payload.company_website ?? "").trim()) return { ok: false, code: "honeypot" };

  const requestId = String(payload.request_id ?? "").trim();
  const name = String(payload.name ?? "").trim();
  const phone = normalizePhone(payload.phone);
  const email = String(payload.email ?? "").trim().toLowerCase() || null;
  const source = String(payload.source ?? "");
  const consent = payload.contact_consent === true;

  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId)) return { ok: false, code: "invalid_request_id" };
  if (!name || name.length > 160 || /[\u0000-\u001f\u007f]/.test(name)) return { ok: false, code: "invalid_name" };
  if (!phone) return { ok: false, code: "invalid_phone" };
  if (email && (email.length > 320 || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email))) return { ok: false, code: "invalid_email" };
  if (!allowedSources.has(source)) return { ok: false, code: "invalid_source" };
  if (!consent) return { ok: false, code: "contact_consent_required" };

  // Keep only approved CRM fields; free-text goals never enter the database.
  return { ok: true, value: { requestId, name, phone, email, source, consent } };
}

