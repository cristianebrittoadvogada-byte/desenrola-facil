import { buildInterestWhatsAppUrl } from "./lead-whatsapp.mjs";

const form = document.getElementById("interest-form");
const status = document.getElementById("form-message");
const continueLink = document.getElementById("whatsapp-continue");
const phoneInput = document.getElementById("interest-phone");
const submitButton = document.getElementById("prepare-message");
const intakeUrl = "https://majpjlklkbswvvxwpvdm.supabase.co/functions/v1/lead-intake";
const siteChatUrl = "https://majpjlklkbswvvxwpvdm.supabase.co/functions/v1/site-chat";
const siteChatForm = document.getElementById("site-chat-form");
const siteChatLog = document.getElementById("site-chat-log");
const siteChatStatus = document.getElementById("site-chat-status");
const siteChatConsent = document.getElementById("site-chat-consent");
const siteChatInput = document.getElementById("site-chat-input");
const siteChatSend = document.getElementById("site-chat-send");
const siteChatContact = document.getElementById("site-chat-contact");
const siteChatSection = document.getElementById("assistente");
const siteChatHistory = [];
const siteChatSessionId = crypto.randomUUID();
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

function appendSiteChatMessage(role, content) {
  const message = document.createElement("p");
  message.className = `chat-message chat-message-${role}`;
  message.textContent = content;
  siteChatLog.append(message);
  while (siteChatLog.childElementCount > 8) siteChatLog.firstElementChild.remove();
  siteChatLog.scrollTop = siteChatLog.scrollHeight;
}

async function configureSiteChat() {
  const config = window.DESENROLA_SUPABASE_CONFIG;
  if (!config?.url || !config?.key || !siteChatForm) {
    siteChatStatus.textContent = "A assistente virtual não está disponível agora. Você pode pedir retorno da equipe pelo formulário abaixo.";
    return;
  }
  try {
    const response = await fetch(siteChatUrl, {
      method: "GET",
      headers: { apikey: config.key },
      cache: "no-store",
    });
    const state = await response.json().catch(() => ({}));
    if (!response.ok || state.available !== true) {
      siteChatStatus.textContent = "A assistente virtual ainda não está ativada. Você pode pedir retorno da equipe pelo formulário abaixo.";
      return;
    }
    siteChatSection.hidden = false;
    siteChatConsent.disabled = false;
    siteChatInput.disabled = false;
    siteChatStatus.textContent = "Assistente virtual disponível. As respostas são informativas e usam somente os dados aprovados da mentoria.";
  } catch {
    siteChatStatus.textContent = "A assistente virtual não está disponível agora. Você pode pedir retorno da equipe pelo formulário abaixo.";
  }
}

siteChatConsent?.addEventListener("change", () => {
  siteChatSend.disabled = !siteChatConsent.checked || siteChatInput.disabled;
});

siteChatForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const text = siteChatInput.value.trim();
  if (!text) return;
  if (!siteChatConsent.checked) {
    siteChatStatus.textContent = "Marque a ciência sobre o processamento por IA antes de enviar sua pergunta.";
    return;
  }
  const config = window.DESENROLA_SUPABASE_CONFIG;
  if (!config?.key) {
    siteChatStatus.textContent = "A assistente virtual não está disponível agora. Você pode pedir retorno da equipe pelo formulário abaixo.";
    return;
  }

  siteChatInput.value = "";
  siteChatInput.disabled = true;
  siteChatSend.disabled = true;
  siteChatHistory.push({ role: "user", content: text });
  if (siteChatHistory.length > 8) siteChatHistory.splice(0, siteChatHistory.length - 8);
  const messages = siteChatHistory.slice(-8);
  appendSiteChatMessage("user", text);
  siteChatStatus.textContent = "Preparando uma resposta…";

  try {
    const response = await fetch(siteChatUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: config.key },
      body: JSON.stringify({ messages, notice_accepted: siteChatConsent.checked, session_id: siteChatSessionId }),
      cache: "no-store",
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || typeof result.reply !== "string") {
      const unavailable = response.status === 429
        ? "O limite gratuito ou temporário foi atingido. Você pode pedir retorno da equipe pelo formulário."
        : "Não consegui responder agora. Você pode pedir retorno da equipe pelo formulário abaixo.";
      appendSiteChatMessage("assistant", unavailable);
      siteChatStatus.textContent = unavailable;
      return;
    }
    siteChatHistory.push({ role: "assistant", content: result.reply });
    if (siteChatHistory.length > 8) siteChatHistory.splice(0, siteChatHistory.length - 8);
    appendSiteChatMessage("assistant", result.reply);
    siteChatStatus.textContent = "Resposta pronta. A conversa fica somente nesta sessão do navegador e não vai para o CRM.";
  } catch {
    const unavailable = "Não consegui responder agora. Você pode pedir retorno da equipe pelo formulário abaixo.";
    appendSiteChatMessage("assistant", unavailable);
    siteChatStatus.textContent = unavailable;
  } finally {
    siteChatInput.disabled = false;
    siteChatSend.disabled = !siteChatConsent.checked;
    siteChatInput.focus();
  }
});

siteChatContact?.addEventListener("click", () => {
  recordConversion("site_chat_contact_clicked", "site-chat");
  document.getElementById("interesse")?.scrollIntoView({ behavior: "smooth", block: "start" });
  document.getElementById("interest-name")?.focus({ preventScroll: true });
});

configureSiteChat();

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

document.querySelectorAll('a[href^="https://loja.infinitepay.io/"]').forEach((link) => {
  link.addEventListener("click", () => recordConversion("checkout_cta_clicked", link.dataset.ctaLocation ?? "unknown"));
});

continueLink.addEventListener("click", () => recordConversion("lead_whatsapp_clicked", "lead-form"));

