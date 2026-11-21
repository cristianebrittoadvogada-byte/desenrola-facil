function constantTimeEqual(left, right) {
  if (typeof left !== "string" || typeof right !== "string" || left.length !== right.length) return false;
  let mismatch = 0;
  for (let i = 0; i < left.length; i += 1) mismatch |= left.charCodeAt(i) ^ right.charCodeAt(i);
  return mismatch === 0;
}

export function verifyAsaasWebhookToken(received, expected) {
  if (typeof expected !== "string" || expected.length < 32 || expected.length > 255 || /\s/.test(expected)) return false;
  return constantTimeEqual(received, expected);
}

export function normalizeAsaasEvent(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const id = typeof payload.id === "string" ? payload.id.trim() : "";
  const event = typeof payload.event === "string" ? payload.event.trim() : "";
  const paymentId = typeof payload.payment?.id === "string" ? payload.payment.id.trim() : "";
  if (!id || id.length > 200 || !event || event.length > 100 || !paymentId || paymentId.length > 200) return null;
  return { id, event, paymentId };
}

export function reconcileAsaasPayment({ event, payment, session }) {
  if (!event || !payment || !session || payment.id !== session.external_charge_id) return { action: "ignore", reason: "charge_mismatch" };
  if (String(payment.externalReference ?? "") !== String(session.sale_id)) return { action: "ignore", reason: "sale_reference_mismatch" };
  const paymentCents = Math.round(Number(payment.value) * 100);
  const sessionCents = Math.round(Number(session.amount) * 100);
  if (!Number.isSafeInteger(paymentCents) || paymentCents !== sessionCents) return { action: "ignore", reason: "amount_mismatch" };

  if (event === "PAYMENT_CONFIRMED" && payment.status === "CONFIRMED") {
    return { action: "confirm_sale", fundsAvailable: false, sessionStatus: "confirmed" };
  }
  if (event === "PAYMENT_RECEIVED" && payment.status === "RECEIVED") {
    return { action: "confirm_sale", fundsAvailable: true, sessionStatus: "confirmed" };
  }
  if (["PAYMENT_OVERDUE", "PAYMENT_DELETED", "PAYMENT_REFUNDED", "PAYMENT_REFUND_IN_PROGRESS"].includes(event)) {
    const status = event === "PAYMENT_OVERDUE" ? "overdue" : event.includes("REFUND") ? "refunded" : "cancelled";
    return { action: "update_session", fundsAvailable: false, sessionStatus: status };
  }
  return { action: "ignore", reason: "event_status_mismatch" };
}
