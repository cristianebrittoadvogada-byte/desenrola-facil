import { createClient } from "@supabase/supabase-js";
import { canSendAutomatedMessage, decideSalesReply, nextFollowUpAt } from "../agent/core.mjs";
import { normalizeMetaWebhook } from "./normalize.mjs";
import { recordExplicitServiceConsent } from "./consent.mjs";
import { sendMetaTextMessage } from "./provider.mjs";
import { verifyMetaWebhookChallenge, verifyMetaWebhookSignature } from "./security.mjs";

const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const database = supabaseUrl && serviceKey
  ? createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })
  : null;
const graphVersion = Deno.env.get("META_GRAPH_VERSION") ?? "v27.0";

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

function messageKey(event) { return `${event.accountId}:${event.externalId}`; }
function isInsideServiceWindow(receivedAt) {
  const age = Date.now() - Date.parse(receivedAt);
  return Number.isFinite(age) && age >= -5 * 60_000 && age < 24 * 60 * 60_000;
}
function waitUntil(promise) {
  const runtime = Reflect.get(globalThis, "EdgeRuntime");
  if (runtime && typeof runtime.waitUntil === "function") runtime.waitUntil(promise);
  else void promise;
}

async function loadMetaCredentials() {
  if (!database) return null;
  const { data: settings, error: settingsError } = await database.from("integration_settings")
    .select("public_config,secret_reference").eq("provider", "instagram_graph").maybeSingle();
  if (settingsError || !settings?.secret_reference) return null;
  const { data, error } = await database.rpc("meta_instagram_secret_read", { p_secret_id: settings.secret_reference });
  if (error || typeof data !== "string") return null;
  let credential;
  try { credential = JSON.parse(data); } catch { return null; }
  return {
    appSecret: typeof credential.app_secret === "string" ? credential.app_secret : "",
    verifyToken: typeof credential.verify_token === "string" ? credential.verify_token : "",
    instagramAccountId: typeof credential.account_id === "string" ? credential.account_id : "",
    instagramAccessToken: typeof credential.access_token === "string" ? credential.access_token : "",
  };
}

async function persistInbound(event) {
  const eventId = messageKey(event);
  const { data: contactId, error: contactError } = await database.rpc("resolve_channel_contact", {
    p_channel: event.channel,
    p_provider_account_id: event.accountId,
    p_external_user_id: event.senderId,
    p_display_name: event.displayName,
    p_phone: event.phone,
  });
  if (contactError || !contactId) throw new Error("contact_resolution_failed");

  await recordExplicitServiceConsent(database, { contactId, event });

  const { error: threadWriteError } = await database.from("conversation_threads").upsert({
    contact_id: contactId, channel: event.channel, provider_account_id: event.accountId,
    external_conversation_id: event.conversationId, last_message_at: event.receivedAt,
  }, { onConflict: "channel,provider_account_id,external_conversation_id", ignoreDuplicates: true });
  if (threadWriteError) throw new Error("thread_save_failed");
  const { data: thread, error: threadReadError } = await database.from("conversation_threads")
    .select("id,control_state").eq("channel", event.channel)
    .eq("provider_account_id", event.accountId).eq("external_conversation_id", event.conversationId).single();
  if (threadReadError || !thread) throw new Error("thread_read_failed");

  const body = event.text ?? (event.oversized ? "[Mensagem acima do limite automático; encaminhada para atendimento humano.]" : "[Mensagem com mídia ou formato não suportado; encaminhada para atendimento humano.]");
  const { data: conversation, error: messageError } = await database.from("conversation_events").insert({
    contact_id: contactId, thread_id: thread.id, channel: event.channel, direction: "inbound",
    actor_type: "customer", body, external_event_id: eventId, occurred_at: event.receivedAt,
    delivery_status: "received", safe_metadata: {
      event_type: event.eventType,
      ...(event.campaignSource ? { campaign_source: event.campaignSource } : {}),
      ...(event.handoffReason ? { handoff_reason: event.handoffReason } : {}),
    },
  }).select("id").maybeSingle();
  if (messageError?.code === "23505") {
    const { data: existingMessage, error: existingMessageError } = await database.from("conversation_events")
      .select("id").eq("channel", event.channel).eq("external_event_id", eventId).maybeSingle();
    if (existingMessageError || !existingMessage) throw new Error("message_recovery_failed");
    const { data: existingJob, error: existingJobError } = await database.from("automation_jobs")
      .select("id,status").eq("provider", event.provider).eq("job_type", "incoming_message").eq("external_event_id", eventId).maybeSingle();
    if (existingJobError) throw new Error("job_lookup_failed");
    if (existingJob) return { duplicate: true, jobId: existingJob.id, jobStatus: existingJob.status, contactId, threadId: thread.id };
    const repairedJob = await database.from("automation_jobs").insert({
      provider: event.provider, job_type: "incoming_message", external_event_id: eventId,
      event_hash: await sha256Hex(eventId), contact_id: contactId, thread_id: thread.id,
      conversation_event_id: existingMessage.id,
    }).select("id").single();
    if (repairedJob.error || !repairedJob.data) throw new Error("job_recovery_failed");
    return { duplicate: true, jobId: repairedJob.data.id, jobStatus: "queued", contactId, threadId: thread.id };
  }
  if (messageError || !conversation) throw new Error("message_persistence_failed");

  const { data: job, error: jobError } = await database.from("automation_jobs").insert({
    provider: event.provider, job_type: "incoming_message", external_event_id: eventId,
    event_hash: await sha256Hex(eventId), contact_id: contactId, thread_id: thread.id,
    conversation_event_id: conversation.id,
  }).select("id").maybeSingle();
  if (jobError?.code === "23505") {
    const existing = await database.from("automation_jobs").select("id,status")
      .eq("provider", event.provider).eq("job_type", "incoming_message").eq("external_event_id", eventId).maybeSingle();
    if (existing.error || !existing.data) throw new Error("job_lookup_failed");
    return { duplicate: true, jobId: existing.data.id, contactId, threadId: thread.id };
  }
  if (jobError || !job) throw new Error("job_persistence_failed");
  return { jobId: job.id, contactId, threadId: thread.id };
}

async function processJob(event, references, metaCredentials) {
  if (!references.jobId) return;
  const { data: job, error: jobReadError } = await database.from("automation_jobs")
    .select("id,status,attempts,thread_id,conversation_event_id")
    .eq("id", references.jobId).single();
  if (jobReadError || !job || ["completed", "ignored", "failed"].includes(job.status)) return;
  const { data: claim, error: claimError } = await database.from("automation_jobs")
    .update({ status: "processing", attempts: job.attempts + 1 })
    .eq("id", job.id).in("status", ["queued", "retrying"]).select("id").maybeSingle();
  if (claimError || !claim) return;
  const fail = async (code, status = "failed") => {
    await database.from("automation_jobs").update({ status, safe_error_code: code }).eq("id", job.id);
    const eventStatus = status === "failed" ? "failed" : status === "ignored" ? "ignored" : "retrying";
    await database.from("integration_events").update({ processing_status: eventStatus, safe_error_code: code })
      .eq("provider", event.provider).eq("external_event_id", messageKey(event));
  };

  if (event.requiresHuman) {
    const handoffReason = event.handoffReason
      ? `Meta sinalizou transferência humana (${event.handoffReason})`
      : event.oversized ? "Mensagem excede limite da automação" : "Mensagem requer análise humana";
    await database.from("conversation_threads").update({ control_state: "human_requested", handoff_reason: handoffReason }).eq("id", job.thread_id);
    await fail("human_handoff", "ignored");
    return;
  }
  const { data: thread, error: threadError } = await database.from("conversation_threads")
    .select("control_state").eq("id", job.thread_id).single();
  const { data: inbound, error: inboundError } = await database.from("conversation_events")
    .select("body").eq("id", job.conversation_event_id).single();
  if (threadError || inboundError || !thread || !inbound) return await fail("message_context_unavailable", "retrying");
  if (thread.control_state !== "automation") return await fail("human_has_control", "ignored");
  if (!isInsideServiceWindow(event.receivedAt)) {
    await database.from("conversation_threads").update({ control_state: "human_requested", handoff_reason: "Janela de resposta automática encerrada" }).eq("id", job.thread_id);
    return await fail("provider_reply_window_expired", "ignored");
  }

  const { data: offers, error: offerError } = await database.from("products")
    .select("code,name,category,price,currency,format,duration_text,delivery_mode")
    .eq("active", true).order("name");
  if (offerError) return await fail("offer_catalog_unavailable", "retrying");
  const decision = decideSalesReply({ text: inbound.body, offers: offers ?? [], controlState: thread.control_state });
  if (decision.intent === "offer_interest" && decision.productCode) {
    const product = (offers ?? []).find((item) => item.code === decision.productCode);
    if (product) {
      const { error: interestError } = await database.from("contacts").update({ interest_code: product.code }).eq("id", references.contactId);
      if (interestError) return await fail("lead_qualification_failed", "retrying");
      const { error: contactStageError } = await database.from("contacts").update({ lifecycle_stage: "qualified" })
        .eq("id", references.contactId).in("lifecycle_stage", ["lead", "disqualified"]);
      if (contactStageError) return await fail("contact_stage_update_failed", "retrying");
      const { data: existingOpportunity, error: opportunityReadError } = await database.from("opportunities")
        .select("id,stage,next_follow_up_at")
        .eq("contact_id", references.contactId).eq("product_id", product.id)
        .order("created_at", { ascending: false }).limit(1).maybeSingle();
      if (opportunityReadError) return await fail("opportunity_lookup_failed", "retrying");
      if (existingOpportunity && !["won", "lost"].includes(existingOpportunity.stage)) {
        const { error } = await database.from("opportunities").update({
          stage: "qualified", expected_value: product.price,
          next_follow_up_at: nextFollowUpAt(existingOpportunity.next_follow_up_at),
        }).eq("id", existingOpportunity.id);
        if (error) return await fail("opportunity_update_failed", "retrying");
      } else {
        const { error } = await database.from("opportunities").insert({
          contact_id: references.contactId, product_id: product.id, stage: "qualified",
          expected_value: product.price, next_follow_up_at: nextFollowUpAt(null),
        });
        if (error) return await fail("opportunity_create_failed", "retrying");
      }
    }
  }
  if (decision.action === "handoff") {
    await database.from("conversation_threads").update({ control_state: "human_requested", handoff_reason: decision.reason }).eq("id", job.thread_id);
  }
  if (decision.action !== "reply" || !canSendAutomatedMessage({ controlState: thread.control_state, providerAllowsReply: true })) {
    await database.from("automation_jobs").update({ status: "completed" }).eq("id", job.id);
    return;
  }

  const reply = `Atendimento virtual Desenrola Fácil: ${decision.reply}`;
  const { data: outbox, error: outboxError } = await database.from("conversation_events").insert({
    contact_id: references.contactId, thread_id: job.thread_id, channel: event.channel,
    direction: "outbound", actor_type: "automation", body: reply, delivery_status: "queued",
    safe_metadata: { intent: decision.intent ?? "handoff" },
  }).select("id").single();
  if (outboxError || !outbox) return await fail("outbound_record_failed", "retrying");

  const sent = await sendMetaTextMessage({
    channel: event.channel, recipientId: event.senderId, text: reply,
    env: {
      META_GRAPH_VERSION: graphVersion,
      WHATSAPP_PHONE_NUMBER_ID: Deno.env.get("WHATSAPP_PHONE_NUMBER_ID"),
      WHATSAPP_ACCESS_TOKEN: Deno.env.get("WHATSAPP_ACCESS_TOKEN"),
      INSTAGRAM_ACCOUNT_ID: metaCredentials?.instagramAccountId,
      INSTAGRAM_ACCESS_TOKEN: metaCredentials?.instagramAccessToken,
    },
  });
  if (!sent.ok) {
    await database.from("conversation_events").update({ delivery_status: "failed" }).eq("id", outbox.id);
    await database.from("conversation_threads").update({ control_state: "human_requested", handoff_reason: "Falha no envio automático; atendimento humano necessário" }).eq("id", job.thread_id);
    return await fail(sent.code, "failed");
  }
  await database.from("conversation_events").update({
    delivery_status: "sent", external_event_id: sent.messageId ? `out:${sent.messageId}` : null,
  }).eq("id", outbox.id);
  await database.from("conversation_threads").update({ last_message_at: new Date().toISOString() }).eq("id", job.thread_id);
  await database.from("automation_jobs").update({ status: "completed", safe_error_code: null }).eq("id", job.id);
}

Deno.serve(async (request) => {
  if (request.method === "GET") {
    if (!database) return json({ error: "meta_webhook_not_configured" }, 503);
    const url = new URL(request.url);
    const hasMetaChallenge = ["hub.mode", "hub.challenge", "hub.verify_token"]
      .some((key) => url.searchParams.has(key));
    if (!hasMetaChallenge) {
      return json({ status: "deployed", meta_verification: "awaiting_meta_challenge" });
    }
    const credentials = await loadMetaCredentials();
    if (!credentials?.verifyToken) return json({ error: "meta_webhook_not_configured" }, 503);
    const challenge = verifyMetaWebhookChallenge(url.searchParams, credentials.verifyToken);
    return challenge ? new Response(challenge, { headers: { "Content-Type": "text/plain; charset=utf-8" } }) : json({ error: "invalid_challenge" }, 403);
  }
  if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  if (!database) return json({ error: "meta_webhook_not_configured" }, 503);
  const metaCredentials = await loadMetaCredentials();
  if (!metaCredentials?.appSecret) return json({ error: "meta_webhook_not_configured" }, 503);

  const raw = new Uint8Array(await request.arrayBuffer());
  if (raw.byteLength > 1_048_576) return json({ error: "request_too_large" }, 413);
  const signature = request.headers.get("x-hub-signature-256") ?? "";
  if (!(await verifyMetaWebhookSignature(raw, signature, metaCredentials.appSecret))) return json({ error: "invalid_signature" }, 401);
  let payload;
  try { payload = JSON.parse(new TextDecoder().decode(raw)); } catch { return json({ error: "invalid_json" }, 400); }

  const events = normalizeMetaWebhook(payload);
  for (const event of events) {
    if (!event.accountId || !event.externalId) continue;
    const eventId = messageKey(event);
    const inserted = await database.from("integration_events").insert({
      provider: event.provider, external_event_id: eventId, event_type: event.eventType,
      provider_account_id: event.accountId, event_hash: await sha256Hex(eventId), processing_status: "received",
    }).select("id").maybeSingle();
    let integrationId = inserted.data?.id;
    if (inserted.error?.code === "23505") {
      const { data: existing, error } = await database.from("integration_events")
        .select("id,processing_status").eq("provider", event.provider).eq("external_event_id", eventId).maybeSingle();
      if (error || !existing) return json({ error: "event_lookup_failed" }, 503);
      if (["processed", "ignored", "failed"].includes(existing.processing_status)) continue;
      integrationId = existing.id;
    } else if (inserted.error || !integrationId) return json({ error: "event_persistence_failed" }, 503);

    if (event.deliveryStatus) {
      const { error: statusError } = await database.from("conversation_events").update({ delivery_status: event.deliveryStatus })
        .eq("channel", event.channel).eq("external_event_id", `out:${event.messageId}`);
      if (statusError) {
        await database.from("integration_events").update({ processing_status: "retrying", safe_error_code: "delivery_status_pending" }).eq("id", integrationId);
        return json({ error: "delivery_status_pending" }, 503);
      }
      await database.from("integration_events").update({ processing_status: "processed", processed_at: new Date().toISOString() }).eq("id", integrationId);
      continue;
    }
    if (event.controlAction) {
      const { data: thread } = await database.from("conversation_threads").select("id")
        .eq("channel", "instagram").eq("provider_account_id", event.accountId)
        .eq("external_conversation_id", event.conversationId).maybeSingle();
      if (thread?.id) {
        const control = event.controlAction === "passed"
          ? { control_state: "provider_owned", handoff_reason: "Controle passado a outra integração Meta" }
          : { control_state: "human_requested", handoff_reason: event.controlAction === "taken" ? "Controle Instagram recebido; revisão humana necessária" : "Outro aplicativo solicitou controle do atendimento" };
        await database.from("conversation_threads").update(control).eq("id", thread.id);
      }
      await database.from("integration_events").update({
        processing_status: thread?.id ? "processed" : "ignored", processed_at: new Date().toISOString(),
      }).eq("id", integrationId);
      continue;
    }
    if (!event.senderId) continue;

    try {
      const references = await persistInbound(event);
      if (references.duplicate) {
        await database.from("integration_events").update({ processing_status: "processed", processed_at: new Date().toISOString() }).eq("id", integrationId);
        if (references.jobId && ["queued", "retrying"].includes(references.jobStatus)) {
          const work = processJob(event, references, metaCredentials).catch(async () => {
            await database.from("automation_jobs").update({ status: "failed", safe_error_code: "processing_uncertain" }).eq("id", references.jobId);
          });
          waitUntil(work);
        }
      } else {
        await database.from("integration_events").update({ processing_status: "processed", processed_at: new Date().toISOString() }).eq("id", integrationId);
        const work = processJob(event, references, metaCredentials).catch(async () => {
          await database.from("automation_jobs").update({ status: "failed", safe_error_code: "processing_uncertain" }).eq("id", references.jobId);
        });
        waitUntil(work);
      }
    } catch {
      await database.from("integration_events").update({ processing_status: "retrying", safe_error_code: "message_persistence_pending" }).eq("id", integrationId);
      return json({ error: "message_persistence_pending" }, 503);
    }
  }
  return json({ received: true });
});
