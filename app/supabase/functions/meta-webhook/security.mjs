const textEncoder = new TextEncoder();

function constantTimeEqual(left, right) {
  if (left.length !== right.length) return false;
  let mismatch = 0;
  for (let index = 0; index < left.length; index += 1) {
    mismatch |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return mismatch === 0;
}

export async function verifyMetaWebhookSignature(rawBody, signatureHeader, appSecret) {
  if (!(rawBody instanceof Uint8Array) || !appSecret || typeof signatureHeader !== "string") return false;
  const match = /^sha256=([a-f0-9]{64})$/i.exec(signatureHeader);
  if (!match || !globalThis.crypto?.subtle) return false;

  const key = await crypto.subtle.importKey(
    "raw",
    textEncoder.encode(appSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const digest = new Uint8Array(await crypto.subtle.sign("HMAC", key, rawBody));
  let expected = "";
  for (const byte of digest) expected += byte.toString(16).padStart(2, "0");
  return constantTimeEqual(expected, match[1].toLowerCase());
}

export function verifyMetaWebhookChallenge(params, expectedVerifyToken) {
  const mode = params?.get("hub.mode");
  const challenge = params?.get("hub.challenge");
  const receivedToken = params?.get("hub.verify_token");
  if (mode !== "subscribe" || !challenge || !receivedToken || !expectedVerifyToken) return null;
  return constantTimeEqual(receivedToken, expectedVerifyToken) ? challenge : null;
}

