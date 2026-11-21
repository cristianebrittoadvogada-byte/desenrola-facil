const SANDBOX_ORIGIN = "https://api-sandbox.asaas.com/v3";

export function isTrustedAsaasCheckoutUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && (url.hostname === "asaas.com" || url.hostname.endsWith(".asaas.com"));
  } catch {
    return false;
  }
}

export async function asaasRequest(path, apiKey, { method = "GET", body } = {}, fetchImpl = fetch) {
  if (typeof apiKey !== "string" || apiKey.length < 10 || !path.startsWith("/")) return { ok: false, uncertain: false, code: "not_configured" };
  try {
    const response = await fetchImpl(`${SANDBOX_ORIGIN}${path}`, {
      method,
      headers: { accept: "application/json", access_token: apiKey, "user-agent": "DesenrolaFacil/1.0", ...(body ? { "content-type": "application/json" } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(10000),
    });
    const data = await response.json().catch(() => ({}));
    return { ok: response.ok, status: response.status, data, uncertain: false };
  } catch {
    return { ok: false, uncertain: true, code: "provider_result_uncertain" };
  }
}

export function asaasCustomerPayload({ fullName, cpfCnpj, email, phone, contactId }) {
  return {
    name: fullName,
    cpfCnpj,
    ...(email ? { email } : {}),
    ...(phone ? { mobilePhone: phone.replace(/\D/g, "").slice(-11) } : {}),
    externalReference: contactId,
    notificationDisabled: true,
  };
}

export function asaasPaymentPayload({ customerId, amount, saleId, productName, billingType, installments = 1, dueDate }) {
  const payload = {
    customer: customerId,
    billingType,
    value: Number(amount),
    dueDate,
    description: String(productName).slice(0, 500),
    externalReference: saleId,
  };
  if (billingType === "CREDIT_CARD" && Number(installments) > 1) {
    payload.installmentCount = Number(installments);
    payload.totalValue = Number(amount);
  }
  return payload;
}
