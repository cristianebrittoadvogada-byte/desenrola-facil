import { createClient } from "@supabase/supabase-js";
import { asaasCustomerPayload, asaasPaymentPayload, asaasRequest, isTrustedAsaasCheckoutUrl } from "./asaas.mjs";

const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const apiKey = Deno.env.get("ASAAS_SANDBOX_API_KEY") ?? "";
const allowedOrigins = (Deno.env.get("WEB_ORIGIN") ?? "http://localhost:3000,http://127.0.0.1:3000,https://desenrola-facil-painel.onrender.com")
  .split(",").map((value) => value.trim()).filter(Boolean);
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function reply(body, status, origin = "") {
  const headers = new Headers({ "content-type": "application/json; charset=utf-8", "cache-control": "no-store", vary: "Origin" });
  if (origin && allowedOrigins.includes(origin)) {
    headers.set("access-control-allow-origin", origin);
    headers.set("access-control-allow-headers", "authorization, apikey, content-type");
    headers.set("access-control-allow-methods", "POST, OPTIONS");
  }
  return new Response(status === 204 ? null : JSON.stringify(body), { status, headers });
}

function cleanTaxId(value) {
  const digits = typeof value === "string" ? value.replace(/\D/g, "") : "";
  return [11, 14].includes(digits.length) ? digits : "";
}

function validateTaxId(value) {
  const digits = cleanTaxId(value);
  if (!digits || /^([0-9])\1+$/.test(digits)) return false;
  const calculate = (base, weights) => {
    const sum = [...base].reduce((total, digit, index) => total + Number(digit) * weights[index], 0);
    const remainder = sum % 11;
    return remainder < 2 ? 0 : 11 - remainder;
  };
  if (digits.length === 11) {
    const first = calculate(digits.slice(0, 9), [10,9,8,7,6,5,4,3,2]);
    const second = calculate(digits.slice(0, 9) + first, [11,10,9,8,7,6,5,4,3,2]);
    return digits.endsWith(`${first}${second}`);
  }
  const first = calculate(digits.slice(0, 12), [5,4,3,2,9,8,7,6,5,4,3,2]);
  const second = calculate(digits.slice(0, 12) + first, [6,5,4,3,2,9,8,7,6,5,4,3,2]);
  return digits.endsWith(`${first}${second}`);
}

Deno.serve(async (request) => {
  const origin = request.headers.get("origin") ?? "";
  if (request.method === "OPTIONS") return reply({}, 204, origin);
  if (request.method !== "POST") return reply({ error: "method_not_allowed" }, 405, origin);
  if (!supabaseUrl || !anonKey || !serviceKey || !apiKey) return reply({ error: "asaas_sandbox_not_configured" }, 503, origin);
  const authorization = request.headers.get("authorization");
  if (!authorization?.startsWith("Bearer ")) return reply({ error: "authentication_required" }, 401, origin);

  const userDb = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: authData, error: authError } = await userDb.auth.getUser();
  if (authError || !authData.user) return reply({ error: "invalid_session" }, 401, origin);
  const { data: roles, error: roleError } = await userDb.from("user_roles").select("role").eq("user_id", authData.user.id);
  if (roleError || !(roles ?? []).some(({ role }) => ["owner", "admin", "commercial", "finance"].includes(role))) {
    return reply({ error: "payment_access_denied" }, 403, origin);
  }

  let input;
  try {
    const raw = await request.text();
    if (new TextEncoder().encode(raw).byteLength > 16_384) return reply({ error: "request_too_large" }, 413, origin);
    input = JSON.parse(raw);
  } catch { return reply({ error: "invalid_request" }, 400, origin); }
  const saleId = typeof input.sale_id === "string" ? input.sale_id : "";
  if (!uuidPattern.test(saleId)) return reply({ error: "invalid_sale_id" }, 422, origin);

  const { data: sale, error: saleError } = await userDb.from("sales")
    .select("id,contact_id,status,amount,payment_method,installments,contacts!inner(full_name,email,phone),products!inner(name)")
    .eq("id", saleId).single();
  if (saleError || !sale) return reply({ error: "sale_unavailable" }, 404, origin);
  if (sale.status !== "pending" || !["pix", "card"].includes(sale.payment_method)) return reply({ error: "sale_not_checkout_eligible" }, 409, origin);
  if (sale.payment_method === "card" && sale.installments !== null && (!Number.isInteger(sale.installments) || sale.installments < 1 || sale.installments > 12)) {
    return reply({ error: "invalid_installments" }, 422, origin);
  }

  const serviceDb = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: knownCustomer, error: knownCustomerError } = await serviceDb.from("payment_customers")
    .select("external_customer_id").eq("provider", "asaas").eq("contact_id", sale.contact_id).maybeSingle();
  if (knownCustomerError) return reply({ error: "customer_reference_unavailable" }, 503, origin);
  const cpfCnpj = cleanTaxId(input.cpf_cnpj);
  if (!knownCustomer?.external_customer_id && !validateTaxId(cpfCnpj)) return reply({ error: "valid_cpf_cnpj_required" }, 422, origin);
  const requestId = crypto.randomUUID();
  const reserved = await serviceDb.rpc("reserve_asaas_payment_session", { p_sale_id: sale.id, p_request_id: requestId });
  const reservation = Array.isArray(reserved.data) ? reserved.data[0] : reserved.data;
  if (reserved.error || !reservation) return reply({ error: "checkout_reservation_failed" }, 409, origin);
  if (reservation.checkout_request_id !== requestId) {
    if (reservation.checkout_url && isTrustedAsaasCheckoutUrl(reservation.checkout_url)) return reply({ data: { checkout_url: reservation.checkout_url, status: reservation.status, reused: true } }, 200, origin);
    return reply({ error: "checkout_reconciliation_required" }, 409, origin);
  }

  let customerId;
  if (knownCustomer?.external_customer_id) customerId = knownCustomer.external_customer_id;
  else {
    const search = await asaasRequest(`/customers?externalReference=${encodeURIComponent(sale.contact_id)}`, apiKey);
    if (!search.ok) return reply({ error: "customer_lookup_failed" }, 502, origin);
    customerId = search.data?.data?.[0]?.id;
    if (!customerId) {
      const created = await asaasRequest("/customers", apiKey, {
        method: "POST",
        body: asaasCustomerPayload({
          fullName: sale.contacts.full_name, cpfCnpj, email: sale.contacts.email,
          phone: sale.contacts.phone, contactId: sale.contact_id,
        }),
      });
      if (!created.ok) {
        if (!created.uncertain) await serviceDb.from("payment_sessions").update({ status: "failed" }).eq("id", reservation.id);
        return reply({ error: created.uncertain ? "provider_result_uncertain" : "customer_creation_failed" }, 502, origin);
      }
      customerId = created.data?.id;
    }
    if (typeof customerId !== "string" || !customerId) return reply({ error: "customer_creation_failed" }, 502, origin);
    const { error: customerSaveError } = await serviceDb.from("payment_customers").upsert({
      provider: "asaas", contact_id: sale.contact_id, external_customer_id: customerId,
    }, { onConflict: "provider,contact_id" });
    if (customerSaveError) return reply({ error: "customer_reference_save_failed" }, 503, origin);
  }

  const billingType = sale.payment_method === "pix" ? "PIX" : "CREDIT_CARD";
  const dueDate = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const payment = await asaasRequest("/payments", apiKey, {
    method: "POST",
    body: asaasPaymentPayload({
      customerId, amount: sale.amount, saleId: sale.id, productName: sale.products.name,
      billingType, installments: sale.installments ?? 1, dueDate,
    }),
  });
  if (!payment.ok) {
    if (!payment.uncertain) await serviceDb.from("payment_sessions").update({ status: "failed" }).eq("id", reservation.id);
    return reply({ error: payment.uncertain ? "provider_result_uncertain" : "charge_creation_failed" }, 502, origin);
  }
  const chargeId = payment.data?.id;
  const checkoutUrl = payment.data?.invoiceUrl;
  if (typeof chargeId !== "string" || !isTrustedAsaasCheckoutUrl(checkoutUrl)) {
    return reply({ error: "provider_result_uncertain" }, 502, origin);
  }
  const { error: sessionUpdateError } = await serviceDb.from("payment_sessions").update({
    external_charge_id: chargeId, checkout_url: checkoutUrl, status: "pending",
  }).eq("id", reservation.id);
  if (sessionUpdateError) return reply({ error: "checkout_result_uncertain" }, 503, origin);
  return reply({ data: { checkout_url: checkoutUrl, status: "pending", reused: false } }, 201, origin);
});
