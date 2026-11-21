import { buildInterestWhatsAppUrl } from "./lead-whatsapp.mjs";

const form = document.getElementById("interest-form");
const status = document.getElementById("form-message");
const continueLink = document.getElementById("whatsapp-continue");
const phoneInput = document.getElementById("interest-phone");

function validatePhone() {
  const digits = phoneInput.value.replace(/\D/g, "");
  phoneInput.setCustomValidity(phoneInput.value.trim() && (digits.length < 10 || digits.length > 15)
    ? "Informe um número com DDD e entre 10 e 15 dígitos."
    : "");
}

phoneInput.addEventListener("input", validatePhone);

function recordConversion(name, ctaLocation = "unknown") {
  const event = { event: name, form_name: "mentoria_interest", cta_location: ctaLocation, page_path: window.location.pathname, occurred_at: new Date().toISOString() };
  window.dataLayer = Array.isArray(window.dataLayer) ? window.dataLayer : [];
  window.dataLayer.push(event);
  try {
    const previous = JSON.parse(sessionStorage.getItem("df_conversion_events") || "[]");
    const events = Array.isArray(previous) ? previous : [];
    events.push(event);
    sessionStorage.setItem("df_conversion_events", JSON.stringify(events.slice(-30)));
  } catch { /* Conversion event remains available in dataLayer for this page view. */ }
}

document.getElementById("prepare-message").addEventListener("click", () => {
  validatePhone();
  if (!form.reportValidity()) return;
  try {
    continueLink.href = buildInterestWhatsAppUrl({
      name: document.getElementById("interest-name").value,
      phone: document.getElementById("interest-phone").value,
      email: document.getElementById("interest-email").value,
      focus: document.getElementById("interest-focus").value,
      goal: document.getElementById("interest-goal").value,
      consent: document.getElementById("interest-consent").checked,
    });
    recordConversion("lead_form_prepared", "lead-form");
    continueLink.hidden = false;
    status.textContent = "Mensagem preparada. Abra o WhatsApp, revise o texto e envie para concluir seu contato.";
    continueLink.focus();
  } catch (error) {
    const messages = {
      name_required: "Informe seu nome para preparar a mensagem.",
      valid_whatsapp_required: "Confira o número de WhatsApp com DDD.",
      goal_required: "Conte qual objetivo ou dificuldade deseja trabalhar.",
      contact_consent_required: "Marque a autorização para receber resposta sobre este pedido.",
    };
    status.textContent = messages[error.message] ?? "Confira os campos e tente novamente.";
  }
});

document.querySelectorAll('a[href^="https://wa.me/"]').forEach((link) => {
  link.addEventListener("click", () => recordConversion("whatsapp_cta_clicked", link.dataset.ctaLocation ?? "unknown"));
});

continueLink.addEventListener("click", () => recordConversion("lead_whatsapp_clicked", "lead-form"));
