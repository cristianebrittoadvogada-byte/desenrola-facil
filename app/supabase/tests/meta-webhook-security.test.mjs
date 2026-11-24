import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { resolveMetaWebhookSecrets, verifyMetaWebhookSignature, verifyMetaWebhookChallenge } from "../functions/meta-webhook/security.mjs";

test("Meta webhook secrets prefer environment values and fall back to Vault", () => {
  assert.deepEqual(resolveMetaWebhookSecrets(
    { META_APP_SECRET: "environment-app-secret", META_WEBHOOK_VERIFY_TOKEN: "environment-verify-token" },
    { app_secret: "vault-app-secret", verify_token: "vault-verify-token" },
  ), { appSecret: "environment-app-secret", verifyToken: "environment-verify-token" });
  assert.deepEqual(resolveMetaWebhookSecrets(
    {},
    { app_secret: "vault-app-secret", verify_token: "vault-verify-token" },
  ), { appSecret: "vault-app-secret", verifyToken: "vault-verify-token" });
  assert.deepEqual(resolveMetaWebhookSecrets(), { appSecret: "", verifyToken: "" });
});

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


