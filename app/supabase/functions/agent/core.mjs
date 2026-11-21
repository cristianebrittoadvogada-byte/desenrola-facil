const normalize = (value) => String(value ?? "")
  .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
  .toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();

const HANDOFF_PATTERNS = [
  /\b(humano|pessoa|atendente|cristiane|falar com alguem|falar com uma pessoa)\b/,
  /\b(suicid|me machucar|violencia|abuso|emergencia|crise)\b/,
  /\b(cobranca contestada|pagamento duplicado|reembolso|cancelar compra)\b/,
];

const GREETING_PATTERNS = [/^(oi|ola|bom dia|boa tarde|boa noite|tudo bem|com licenca)$/];

export function canSendAutomatedMessage({ controlState, providerAllowsReply, marketing = false, marketingConsent = false }) {
  if (controlState !== "automation" || providerAllowsReply !== true) return false;
  if (marketing && marketingConsent !== true) return false;
  return true;
}

export function decideSalesReply({ text, offers = [], controlState = "automation" }) {
  if (controlState !== "automation") return { action: "none", reason: "thread_not_automated" };
  const cleaned = normalize(text);
  if (!cleaned) return { action: "reply", intent: "unknown", reply: "Não consegui ler sua mensagem. Pode me contar como posso ajudar?" };

  if (HANDOFF_PATTERNS.some((pattern) => pattern.test(cleaned))) {
    return {
      action: "handoff",
      intent: "human_requested",
      reason: "pedido_de_pessoa_ou_assunto_delicado",
      reply: "Vou encaminhar sua mensagem para atendimento humano da equipe Desenrola Fácil. Por aqui não vou tentar orientar esse assunto automaticamente.",
    };
  }

  if (GREETING_PATTERNS.some((pattern) => pattern.test(cleaned))) {
    return {
      action: "reply",
      intent: "greeting",
      reply: "Olá! Sou o atendimento virtual da Desenrola Fácil. Posso apresentar as ofertas, explicar como funciona a mentoria ou encaminhar você para uma pessoa da equipe. O que você procura?",
    };
  }

  const match = offers.find((offer) => {
    const name = normalize(offer.name);
    const category = normalize(offer.category);
    const words = name.split(" ").filter((word) => word.length > 3);
    const aliases = {
      mentoria: ["mentoria", "ppdd"],
      livro: ["livro"],
      constelacao: ["constelacao", "sistemica"],
      vivencia: ["vivencia", "retiro"],
    }[category] ?? [];
    return cleaned.includes(name) || words.some((word) => cleaned.includes(word)) || aliases.some((word) => cleaned.includes(word));
  });

  if (match) {
    const price = Number(match.price);
    const formattedPrice = Number.isFinite(price)
      ? new Intl.NumberFormat("pt-BR", { style: "currency", currency: match.currency || "BRL" }).format(price)
      : null;
    const details = [formattedPrice, match.format, match.duration_text, match.delivery_mode]
      .filter((value) => typeof value === "string" && value.trim())
      .filter((value, index, all) => all.indexOf(value) === index)
      .join(" · ");
    return {
      action: "reply",
      intent: "offer_interest",
      productCode: match.code,
      reply: `${match.name}${details ? `: ${details}.` : "."} Quer que eu encaminhe para a equipe explicar os próximos passos?`,
    };
  }

  if (/\b(preco|valor|quanto custa|ofertas|servicos|produtos)\b/.test(cleaned)) {
    return {
      action: "reply",
      intent: "offer_list",
      reply: offers.length
        ? `Temos ${offers.length} ofertas cadastradas. Qual delas você quer conhecer? Se preferir, posso chamar uma pessoa da equipe.`
        : "Vou encaminhar sua pergunta para a equipe confirmar as ofertas e os valores atuais.",
    };
  }

  return {
    action: "reply",
    intent: "qualification",
    reply: "Para eu encaminhar você corretamente: está buscando mentoria, atendimento individual, vivência ou o livro? Se preferir, posso chamar uma pessoa da equipe.",
  };
}

export function messageFingerprintParts({ channel, accountId, externalMessageId }) {
  const allowed = new Set(["whatsapp", "instagram"]);
  if (!allowed.has(channel) || !accountId || !externalMessageId) throw new Error("invalid_event_identity");
  return { channel, providerAccountId: String(accountId), externalEventId: String(externalMessageId) };
}

export function nextFollowUpAt(currentAt, now = Date.now()) {
  const current = Date.parse(String(currentAt ?? ""));
  if (Number.isFinite(current) && current > now) return new Date(current).toISOString();
  return new Date(now + 23 * 60 * 60_000).toISOString();
}
