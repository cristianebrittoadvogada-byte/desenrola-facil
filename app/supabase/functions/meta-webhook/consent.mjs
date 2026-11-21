export async function recordExplicitServiceConsent(database, { contactId, event }) {
  if (!contactId || event?.channel !== "whatsapp" || event.serviceContactConsent !== true) {
    return { recorded: false, duplicate: false };
  }
  const evidenceReference = `${event.accountId}:${event.externalId}`;
  const { error } = await database.from("communication_consents").insert({
    contact_id: contactId,
    channel: "whatsapp",
    purpose: "service",
    state: "granted",
    source: "whatsapp_message_explicit_service_consent",
    evidence_reference: evidenceReference,
    occurred_at: event.receivedAt,
  });
  if (error?.code === "23505") return { recorded: false, duplicate: true };
  if (error) throw new Error("consent_persistence_failed");
  return { recorded: true, duplicate: false };
}
