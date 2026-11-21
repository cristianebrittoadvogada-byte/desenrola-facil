const GRAPH_VERSION_PATTERN = /^v\d+\.\d+$/;

export async function sendMetaTextMessage({ channel, recipientId, text, env, fetchImpl = fetch }) {
  if (!recipientId || typeof text !== "string" || !text.trim()) return { ok: false, code: "invalid_message" };
  const version = String(env.META_GRAPH_VERSION ?? "");
  if (!GRAPH_VERSION_PATTERN.test(version)) return { ok: false, code: "graph_version_not_configured" };

  let url;
  let token;
  let body;
  if (channel === "whatsapp") {
    const phoneNumberId = String(env.WHATSAPP_PHONE_NUMBER_ID ?? "");
    token = env.WHATSAPP_ACCESS_TOKEN;
    if (!/^\d+$/.test(phoneNumberId)) return { ok: false, code: "whatsapp_account_not_configured" };
    url = `https://graph.facebook.com/${version}/${phoneNumberId}/messages`;
    body = { messaging_product: "whatsapp", to: recipientId, type: "text", text: { body: text.trim(), preview_url: false } };
  } else if (channel === "instagram") {
    const instagramAccountId = String(env.INSTAGRAM_ACCOUNT_ID ?? "");
    token = env.INSTAGRAM_ACCESS_TOKEN;
    if (!/^\d+$/.test(instagramAccountId)) return { ok: false, code: "instagram_account_not_configured" };
    if (new TextEncoder().encode(text).byteLength > 1000) return { ok: false, code: "instagram_message_too_long" };
    url = `https://graph.instagram.com/${version}/${instagramAccountId}/messages`;
    body = { recipient: { id: recipientId }, message: { text: text.trim() } };
  } else {
    return { ok: false, code: "unsupported_channel" };
  }

  if (typeof token !== "string" || token.length < 10) return { ok: false, code: "provider_not_configured" };

  try {
    const response = await fetchImpl(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) return { ok: false, code: `provider_http_${response.status}` };
    const result = await response.json().catch(() => ({}));
    const messageId = result.messages?.[0]?.id ?? result.message_id ?? null;
    return { ok: true, messageId: typeof messageId === "string" ? messageId : null };
  } catch {
    return { ok: false, code: "provider_unreachable" };
  }
}
