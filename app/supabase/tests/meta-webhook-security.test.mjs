import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { verifyMetaWebhookSignature, verifyMetaWebhookChallenge } from "../functions/meta-webhook/security.mjs";

test("valida assinatura Meta sobre bytes brutos do webhook", async () => {
  const body = new TextEncoder().encode('{"object":"whatsapp_business_account","entry":[]}');
  const secret = "synthetic-meta-app-secret";
  const hex = createHmac("sha256", secret).update(body).digest("hex");
  assert.equal(await verifyMetaWebhookSignature(body, "sha256=" + hex, secret), true);
  assert.equal(await verifyMetaWebhookSignature(new TextEncoder().encode('{"object":"changed"}'), "sha256=" + hex, secret), false);
  assert.equal(await verifyMetaWebhookSignature(body, "sha256=" + hex, "wrong-secret"), false);
  assert.equal(await verifyMetaWebhookSignature(body, "bad-format", secret), false);
});

test("webhook GET só devolve challenge com modo e verify token corretos", () => {
  const valid = new URLSearchParams({ "hub.mode": "subscribe", "hub.challenge": "synthetic-challenge", "hub.verify_token": "synthetic-token" });
  const invalid = new URLSearchParams({ "hub.mode": "subscribe", "hub.challenge": "synthetic-challenge", "hub.verify_token": "wrong" });
  assert.equal(verifyMetaWebhookChallenge(valid, "synthetic-token"), "synthetic-challenge");
  assert.equal(verifyMetaWebhookChallenge(invalid, "synthetic-token"), null);
  assert.equal(verifyMetaWebhookChallenge(new URLSearchParams(), "synthetic-token"), null);
});

