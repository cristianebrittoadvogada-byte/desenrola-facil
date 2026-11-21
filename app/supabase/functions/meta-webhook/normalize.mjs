function isoTimestamp(value) {
  const timestamp = Number(value);
  if (!Number.isFinite(timestamp) || timestamp <= 0) return new Date().toISOString();
  const date = new Date(timestamp > 1_000_000_000_000 ? timestamp : timestamp * 1000);
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}

export function hasExplicitMentorshipServiceConsent(text) {
  if (typeof text !== "string") return false;
  return text.split(/\r?\n/).some((line) =>
    /^\s*Consentimento para retorno sobre a mentoria:\s*SIM\.?\s*$/i.test(line)
  );
}

function hasMentorshipLandingAttribution(text) {
  if (typeof text !== "string") return false;
  return text.split(/\r?\n/).some((line) =>
    /^\s*Origem:\s*Página comercial da Mentoria Desenrola Fácil\.?\s*$/i.test(line)
  );
}

function normalizeWhatsApp(payload) {
  const events = [];
  for (const entry of Array.isArray(payload.entry) ? payload.entry : []) {
    for (const change of Array.isArray(entry.changes) ? entry.changes : []) {
      if (change.field !== "messages") continue;
      const value = change.value ?? {};
      const metadata = value.metadata ?? {};
      for (const message of Array.isArray(value.messages) ? value.messages : []) {
        const senderId = String(message.from ?? "");
        const externalId = String(message.id ?? "");
        if (!senderId || !externalId) continue;
        const sender = (Array.isArray(value.contacts) ? value.contacts : [])
          .find((contact) => String(contact.wa_id ?? "") === senderId);
        const rawText = message.type === "text" && typeof message.text?.body === "string" ? message.text.body : null;
        const text = rawText === null ? null : rawText.slice(0, 4000);
        events.push({
          channel: "whatsapp",
          provider: "whatsapp_cloud",
          accountId: String(metadata.phone_number_id ?? entry.id ?? ""),
          conversationId: senderId,
          senderId,
          displayName: typeof sender?.profile?.name === "string" ? sender.profile.name : null,
          phone: senderId,
          externalId,
          text,
          serviceContactConsent: hasExplicitMentorshipServiceConsent(text),
          campaignSource: hasMentorshipLandingAttribution(text) ? "mentoria_landing_page" : null,
          receivedAt: isoTimestamp(message.timestamp),
          eventType: rawText === null ? "message.unsupported" : "message.text",
          requiresHuman: rawText === null || rawText.length > 4000,
          oversized: rawText !== null && rawText.length > 4000,
        });
      }
      for (const status of Array.isArray(value.statuses) ? value.statuses : []) {
        const messageId = String(status.id ?? "");
        const deliveryStatus = String(status.status ?? "");
        if (!messageId || !["sent", "delivered", "read", "failed"].includes(deliveryStatus)) continue;
        events.push({
          channel: "whatsapp",
          provider: "whatsapp_cloud",
          accountId: String(metadata.phone_number_id ?? entry.id ?? ""),
          externalId: `status:${messageId}:${deliveryStatus}`,
          messageId,
          deliveryStatus,
          receivedAt: isoTimestamp(status.timestamp),
          eventType: `message.status.${deliveryStatus}`,
        });
      }
    }
  }
  return events;
}

function normalizeInstagram(payload) {
  const events = [];
  for (const entry of Array.isArray(payload.entry) ? payload.entry : []) {
    for (const item of Array.isArray(entry.messaging) ? entry.messaging : []) {
      const controlAction = item.pass_thread_control ? "passed"
        : item.take_thread_control ? "taken"
        : item.request_thread_control ? "requested" : null;
      if (controlAction) {
        const accountId = String(entry.id ?? item.recipient?.id ?? "");
        const senderCandidate = String(item.sender?.id ?? "");
        const recipientCandidate = String(item.recipient?.id ?? "");
        const conversationId = senderCandidate && senderCandidate !== accountId ? senderCandidate : recipientCandidate;
        const timestamp = isoTimestamp(item.timestamp);
        if (!accountId || !conversationId) continue;
        events.push({
          channel: "instagram", provider: "instagram_graph", accountId,
          conversationId, externalId: `control:${controlAction}:${conversationId}:${timestamp}`,
          controlAction, receivedAt: timestamp, eventType: `thread.${controlAction}_control`,
        });
        continue;
      }
      const message = item.message;
      const senderId = String(item.sender?.id ?? "");
      const externalId = String(message?.mid ?? "");
      if (!message || message.is_echo === true || !senderId || !externalId) continue;
      const rawText = typeof message.text === "string" ? message.text : null;
      const text = rawText === null ? null : rawText.slice(0, 4000);
      const allowedHandoffReasons = ["purchase_intent", "payment_received", "human_requested", "other"];
      const handoffReason = allowedHandoffReasons.includes(message.handoff_reason) ? message.handoff_reason : null;
      events.push({
        channel: "instagram",
        provider: "instagram_graph",
        accountId: String(entry.id ?? item.recipient?.id ?? ""),
        conversationId: senderId,
        senderId,
        displayName: typeof item.sender?.username === "string" ? item.sender.username : null,
        phone: null,
        externalId,
        text,
        serviceContactConsent: false,
        campaignSource: null,
        handoffReason,
        receivedAt: isoTimestamp(item.timestamp),
        eventType: text === null ? "message.unsupported" : "message.text",
        requiresHuman: text === null || rawText.length > 4000 || handoffReason !== null,
        oversized: rawText !== null && rawText.length > 4000,
      });
    }
  }
  return events;
}

export function normalizeMetaWebhook(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return [];
  if (payload.object === "whatsapp_business_account") return normalizeWhatsApp(payload);
  if (payload.object === "instagram") return normalizeInstagram(payload);
  return [];
}
