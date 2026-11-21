import { buildInterestWhatsAppUrl } from "./lead-whatsapp.mjs";

const form = document.getElementById("interest-form");
const status = document.getElementById("form-message");
const continueLink = document.getElementById("whatsapp-continue");
const phoneInput = document.getElementById("interest-phone");
const submitButton = document.getElementById("prepare-message");
const intakeUrl = "https://nmkneyzyxxhebkurgimh.supabase.co/functions/v1/lead-intake";
let requestId = null;

function validatePhone() {
  const digits = phoneInput.value.replace(/\D/g, "");
  phoneInput.setCustomValidity(phoneInput.value.trim() && (digits.length < 10 || digits.length > 15)
    ? "Informe um número com DDD e entre 10 e 15 dígitos."
    : "");
}

phoneInput.addEventListener("input", validatePhone);

form.addEventListener("input", () => {
  requestId = null;
  continueLink.hidden = true;
  continueLink.href = "#";
});

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

submitButton.addEventListener("click", async () => {
  validatePhone();
  if (!form.reportValidity()) return;

  const config = window.DESENROLA_SUPABASE_CONFIG;
  if (!config?.url || !config?.key) {
    status.textContent = "O envio está temporariamente indisponível. Você pode falar diretamente com a equipe pelo botão do topo.";
    return;
  }

  requestId ??= crypto.randomUUID();
  submitButton.disabled = true;
  submitButton.textContent = "Salvando seu interesse…";
  status.textContent = "Salvando seu contato com segurança no CRM…";
  continueLink.hidden = true;

  try {
    const url = new URL(window.location.href);
    const source = url.searchParams.get("utm_source")?.toLowerCase() === "instagram" || url.searchParams.get("utm_medium")?.toLowerCase() === "bio"
      ? "instagram_bio"
      : url.searchParams.get("utm_source")?.toLowerCase() === "linktree" ? "linktree" : "website:mentoria_sales_page";
    const response = await fetch(intakeUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: config.key },
      body: JSON.stringify({
        request_id: requestId,
        name: document.getElementById("interest-name").value,
        phone: phoneInput.value,
        email: document.getElementById("interest-email").value,
        source,
        contact_consent: document.getElementById("interest-consent").checked,
        company_website: document.getElementById("company-website").value,
      }),
      cache: "no-store",
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || result.accepted !== true) throw new Error(result.error ?? "lead_save_failed");

    continueLink.href = buildInterestWhatsAppUrl({
      name: document.getElementById("interest-name").value,
      phone: document.getElementById("interest-phone").value,
      email: document.getElementById("interest-email").value,
      focus: document.getElementById("interest-focus").value,
      goal: document.getElementById("interest-goal").value,
      consent: document.getElementById("interest-consent").checked,
    });
    recordConversion("lead_saved_to_crm", "lead-form");
    continueLink.hidden = false;
    status.textContent = "Seu interesse foi registrado. Agora você pode revisar e enviar uma mensagem pelo WhatsApp.";
    continueLink.focus();
  } catch (error) {
    const messages = {
      name_required: "Informe seu nome para preparar a mensagem.",
      valid_whatsapp_required: "Confira o número de WhatsApp com DDD.",
      goal_required: "Conte qual objetivo ou dificuldade deseja trabalhar.",
      contact_consent_required: "Marque a autorização para receber resposta sobre este pedido.",
    };
    status.textContent = messages[error.message] ?? "Não foi possível registrar seu interesse agora. Seus dados não foram enviados ao WhatsApp; tente novamente ou fale diretamente com a equipe.";
  } finally {
    submitButton.disabled = false;
    submitButton.textContent = "Salvar interesse e preparar WhatsApp";
  }
});

document.querySelectorAll('a[href^="https://wa.me/"]').forEach((link) => {
  link.addEventListener("click", () => recordConversion("whatsapp_cta_clicked", link.dataset.ctaLocation ?? "unknown"));
});

continueLink.addEventListener("click", () => recordConversion("lead_whatsapp_clicked", "lead-form"));

