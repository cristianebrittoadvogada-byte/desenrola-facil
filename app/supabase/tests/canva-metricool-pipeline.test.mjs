import test from "node:test";
import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import {
  buildCanvaExportRequest,
  buildMetricoolSchedulePayload,
  contentIdempotencyKey,
  createCanvaOAuthParameters,
  extractCanvaDesignId,
  makeStoragePath,
  normalizeMetricoolMedia,
  orderedCanvaExportUrls,
} from "../functions/canva-metricool/logic.mjs";

test("Canva OAuth uses PKCE S256, scoped authorization and single-flow state", async () => {
  const auth = await createCanvaOAuthParameters({ clientId: "canva-client-id", redirectUri: "https://api.example.test/functions/callback", cryptoImpl: webcrypto });
  const url = new URL(auth.authorizationUrl);
  assert.equal(url.origin, "https://www.canva.com");
  assert.equal(url.searchParams.get("code_challenge_method"), "s256");
  assert.equal(url.searchParams.get("scope"), "design:content:read");
  assert.equal(url.searchParams.get("state"), auth.state);
  assert.ok(auth.verifier.length >= 43);
  assert.notEqual(auth.verifier, auth.state);
});

test("Canva export request preserves the design canvas size without requiring a paid export tier", () => {
  assert.equal(extractCanvaDesignId("https://www.canva.com/design/DA1234567/view"), "DA1234567");
  assert.deepEqual(buildCanvaExportRequest({ designId: "DA1234567" }), { design_id: "DA1234567", format: { type: "png", export_quality: "regular" } });
  assert.throws(() => extractCanvaDesignId("https://evil.example/design/DA1234567"), /invalid_canva_design_url/);
});

test("Canva page exports remain in provider-supplied order and receive deterministic private paths", () => {
  const pages = orderedCanvaExportUrls({ job: { status: "success", urls: ["https://export-download.canva.com/a", "https://export-download.canva.com/b"] } });
  assert.deepEqual(pages.map((page) => page.page), [1, 2]);
  assert.equal(makeStoragePath("a23f4567-1111-4111-8111-111111111111", 0, "png"), "a23f4567-1111-4111-8111-111111111111/01.png");
  assert.throws(() => orderedCanvaExportUrls({ job: { status: "success", urls: ["https://evil.example/a"] } }), /export_host_not_allowed/);
});

test("identical design, caption and schedule are deduplicated", async () => {
  const item = { designId: "DA1234567", caption: "Legenda", scheduledAt: "2026-12-01T12:00:00.000Z", format: "png" };
  assert.equal(await contentIdempotencyKey(item), await contentIdempotencyKey(item));
  assert.notEqual(await contentIdempotencyKey(item), await contentIdempotencyKey({ ...item, scheduledAt: "2026-12-02T12:00:00.000Z" }));
});

test("Metricool schedule preserves approved carousel order and timezone", () => {
  const payload = buildMetricoolSchedulePayload({
    caption: "Legenda aprovada",
    scheduledAt: new Date(Date.now() + 60 * 60_000).toISOString(),
    timezone: "America/Sao_Paulo",
    orderedMediaUrls: ["https://media.metricool.com/page-01.png", "https://media.metricool.com/page-02.png"],
  });
  assert.deepEqual(payload.media, ["https://media.metricool.com/page-01.png", "https://media.metricool.com/page-02.png"]);
  assert.equal(payload.providers[0].network, "instagram");
  assert.equal(payload.instagramData.type, "CAROUSEL");
  assert.equal(payload.instagramData.autoPublish, true);
  assert.equal(payload.publicationDate.timezone, "America/Sao_Paulo");
});

test("Metricool scheduling requires a future date, caption and HTTPS media", () => {
  const base = { caption: "Legenda", scheduledAt: new Date(Date.now() + 60_000).toISOString(), timezone: "America/Sao_Paulo", orderedMediaUrls: ["https://cdn.example/img.png"] };
  assert.throws(() => buildMetricoolSchedulePayload({ ...base, scheduledAt: new Date(Date.now() - 60_000).toISOString() }), /schedule_must_be_future/);
  assert.throws(() => buildMetricoolSchedulePayload({ ...base, orderedMediaUrls: ["http://cdn.example/img.png"] }), /invalid_ordered_media/);
});

test("Metricool normalizes media using the official authenticated endpoint", async () => {
  let requested;
  const url = await normalizeMetricoolMedia({
    url: "https://signed.supabase.co/storage/v1/object/sign/private/file.png?token=short-lived",
    token: "secret-token", userId: "123", blogId: "456",
    fetchImpl: async (input, init) => {
      requested = { url: new URL(input), headers: init.headers };
      return new Response(JSON.stringify({ data: { url: "https://media.metricool.com/normalized.png" } }), { status: 200 });
    },
  });
  assert.equal(url, "https://media.metricool.com/normalized.png");
  assert.equal(requested.url.origin, "https://app.metricool.com");
  assert.equal(requested.url.searchParams.get("blogId"), "456");
  assert.equal(requested.headers["X-Mc-Auth"], "secret-token");
});

