const BUSINESS_WHATSAPP = "5521967371083";

export function buildInterestWhatsAppUrl({ name, phone, email = "", focus = "prefiro conversar", goal, consent = false }) {
  const cleanName = String(name ?? "").trim().slice(0, 160);
  const cleanPhone = String(phone ?? "").trim().slice(0, 24);
  const phoneDigits = cleanPhone.replace(/\D/g, "");
  const cleanEmail = String(email ?? "").trim().slice(0, 320);
  const cleanFocus = String(focus ?? "prefiro conversar").trim().slice(0, 80);
  const cleanGoal = String(goal ?? "").trim().slice(0, 600);
  if (!cleanName) throw new Error("name_required");
  if (phoneDigits.length < 10 || phoneDigits.length > 15) throw new Error("valid_whatsapp_required");
  if (!cleanGoal) throw new Error("goal_required");
  if (consent !== true) throw new Error("contact_consent_required");
  const lines = [
    "Olá, quero conversar sobre a Mentoria Desenrola Fácil®.",
    `Meu nome é ${cleanName}.`,
    `Meu WhatsApp para retorno é ${cleanPhone}.`,
    `Tenho interesse em conversar sobre: ${cleanFocus}.`,
    `Minha principal dificuldade ou objetivo: ${cleanGoal}`,
    "Origem: Página comercial da Mentoria Desenrola Fácil.",
    "Consentimento para retorno sobre a mentoria: SIM.",
  ];
  if (cleanEmail) lines.push(`Meu e-mail é ${cleanEmail}.`);
  return `https://wa.me/${BUSINESS_WHATSAPP}?text=${encodeURIComponent(lines.join("\n"))}`;
}

export const BUSINESS_WHATSAPP_NUMBER = BUSINESS_WHATSAPP;

