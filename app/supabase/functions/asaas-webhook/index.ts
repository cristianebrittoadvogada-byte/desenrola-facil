import { createClient } from "@supabase/supabase-js";
import { normalizeAsaasEvent, reconcileAsaasPayment, verifyAsaasWebhookToken } from "./security.mjs";

const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const webhookToken = Deno.env.get("ASAAS_WEBHOOK_AUTH_TOKEN") ?? "";
const apiKey = Deno.env.get("ASAAS_SANDBOX_API_KEY") ?? "";
const database = supabaseUrl && serviceKey
  ? createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })
  : null;

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}

async function sha256Hex(value) {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
  return [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function reconcile(event, eventRowId) {
  const providerResponse = await fetch(`https://api-sandbox.asaas.com/v3/payments/${encodeURIComponent(event.paymentId)}`, {
    headers: { accept: "application/json", access_token: apiKey, "user-agent": "DesenrolaFacil/1.0" },
    signal: AbortSignal.timeout(8000),
  });
  if (!providerResponse.ok) throw new Error("provider_unavailable");
  const payment = await providerResponse.json();
  const { data: session, error: sessionError } = await database.from("payment_sessions")
    .select("id,sale_id,external_charge_id,amount,status")
    .eq("provider", "asaas").eq("external_charge_id", event.paymentId).maybeSingle();
  if (sessionError || !session) throw new Error("session_not_found");

  const result = reconcileAsaasPayment({ event: event.event, payment, session });
  if (result.action === "confirm_sale") {
    const { error } = await database.rpc("confirm_sale_receipt", {
      p_sale_id: session.sale_id,
      p_payment_reference: event.paymentId,
      p_funds_available: result.fundsAvailable,
    });
    if (error) throw new Error("sale_confirmation_failed");
  }
  if (result.action !== "ignore") {
    const { error } = await database.from("payment_sessions").update({ status: result.sessionStatus }).eq("id", session.id);
    if (error) throw new Error("session_update_failed");
  }
  const { error: eventError } = await database.from("integration_events").update({
    processing_status: result.action === "ignore" ? "ignored" : "processed",
    attempts: 1,
    processed_at: new Date().toISOString(),
    safe_error_code: result.action === "ignore" ? result.reason : null,
  }).eq("id", eventRowId);
  if (eventError) throw new Error("event_status_update_failed");
}

Deno.serve(async (request) => {
  if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  if (!database || !webhookToken || !apiKey) return json({ error: "sandbox_webhook_not_configured" }, 503);
  if (!verifyAsaasWebhookToken(request.headers.get("asaas-access-token"), webhookToken)) return json({ error: "unauthorized" }, 401);

  let payload;
  try {
    const raw = await request.text();
    if (new TextEncoder().encode(raw).byteLength > 65_536) return json({ error: "request_too_large" }, 413);
    payload = JSON.parse(raw);
  } catch {
    return json({ error: "invalid_json" }, 400);
  }
  const event = normalizeAsaasEvent(payload);
  if (!event) return json({ received: true, ignored: true });

  const inserted = await database.from("integration_events").insert({
    provider: "asaas",
    external_event_id: event.id,
    event_type: event.event,
    processing_status: "received",
    event_hash: await sha256Hex(`${event.id}:${event.paymentId}`),
  }).select("id").maybeSingle();
  let eventRowId = inserted.data?.id;
  if (inserted.error?.code === "23505") {
    const { data: existing, error } = await database.from("integration_events")
      .select("id,processing_status").eq("provider", "asaas").eq("external_event_id", event.id).maybeSingle();
    if (error || !existing) return json({ error: "event_lookup_failed" }, 503);
    if (["processed", "ignored"].includes(existing.processing_status)) return json({ received: true, duplicate: true });
    eventRowId = existing.id;
  } else if (inserted.error || !eventRowId) {
    return json({ error: "event_persistence_failed" }, 503);
  }

  try {
    await reconcile(event, eventRowId);
    return json({ received: true });
  } catch {
    await database.from("integration_events").update({
      processing_status: "retrying", attempts: 1, safe_error_code: "reconciliation_pending",
    }).eq("id", eventRowId);
    return json({ error: "reconciliation_pending" }, 503);
  }
});
