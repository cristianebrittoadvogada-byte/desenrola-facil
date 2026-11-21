import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { FIRST_OWNER_EMAIL, isFirstOwnerIdentityAllowed, normalizeOwnerProfile } from "../functions/bootstrap-owner/logic.mjs";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");
const migration = await read("../migrations/20261121132758_first_owner_bootstrap.sql");
const functionSource = await read("../functions/bootstrap-owner/index.ts");
const config = await read("../config.toml");
const html = await read("../web/index.html");
const panel = await read("../web/app.js");

test("primeiro acesso aceita apenas e-mail empresarial confirmado", () => {
  assert.equal(FIRST_OWNER_EMAIL, "desenrolafaciljud@gmail.com");
  assert.equal(isFirstOwnerIdentityAllowed({ id: "fictitious-user", email: FIRST_OWNER_EMAIL, email_confirmed_at: "2026-11-21T00:00:00Z" }), true);
  assert.equal(isFirstOwnerIdentityAllowed({ id: "fictitious-user", email: FIRST_OWNER_EMAIL.toUpperCase(), email_confirmed_at: "2026-11-21T00:00:00Z" }), true);
  assert.equal(isFirstOwnerIdentityAllowed({ id: "fictitious-user", email: FIRST_OWNER_EMAIL }), false);
  assert.equal(isFirstOwnerIdentityAllowed({ id: "fictitious-user", email: "alguem@example.invalid", email_confirmed_at: "2026-11-21T00:00:00Z" }), false);
  assert.equal(isFirstOwnerIdentityAllowed({ email: FIRST_OWNER_EMAIL, email_confirmed_at: "2026-11-21T00:00:00Z" }), false);
});

test("perfil administrativo valida tipo e limita nome", () => {
  assert.deepEqual(normalizeOwnerProfile({ full_name: "  Cristiane Britto  " }), { full_name: "Cristiane Britto" });
  for (const input of [null, [], {}, { full_name: " " }, { full_name: "x".repeat(161) }, { full_name: 123 }]) {
    assert.deepEqual(normalizeOwnerProfile(input), { error: "invalid_full_name" });
  }
});

test("RPC de primeiro proprietário é serializada, idempotente e limitada ao service role", () => {
  assert.match(migration, /pg_advisory_xact_lock/);
  assert.match(migration, /email_confirmed_at is not null/);
  assert.match(migration, /desenrolafaciljud@gmail\.com/);
  assert.match(migration, /where role = 'owner' and user_id = p_user_id[\s\S]*?return;/);
  assert.match(migration, /revoke all on function public\.bootstrap_first_company_owner[\s\S]*?from public, anon, authenticated;/);
  assert.match(migration, /grant execute on function public\.bootstrap_first_company_owner[\s\S]*?to service_role;/);
  assert.doesNotMatch(migration, /\b(drop|truncate|delete\s+from)\b/i);
});

test("Edge Function valida JWT e identidade antes de chamar RPC privilegiada", () => {
  assert.match(config, /\[functions\.bootstrap-owner\]\s*verify_jwt\s*=\s*true/);
  assert.match(functionSource, /auth\.getUser\(\)/);
  assert.match(functionSource, /isFirstOwnerIdentityAllowed\(user\)/);
  assert.match(functionSource, /serviceDb\.rpc\("bootstrap_first_company_owner"/);
  assert.doesNotMatch(functionSource, /service_role.{0,80}console\.(log|info|debug)/is);
});

test("painel liga recuperação e primeiro acesso sem cadastro público", () => {
  for (const id of ["show-recovery", "cancel-recovery", "recovery-request-form", "recovery-update-form", "bootstrap-owner-form"]) {
    assert.ok(html.includes(`id="${id}"`), `HTML deve conter ${id}`);
  }
  assert.match(panel, /requestPasswordRecovery\(value\("recovery-email"\)\)/);
  assert.match(panel, /updateRecoveredPassword\(password\)/);
  assert.match(panel, /function detectPasswordSetup\(\)/);
  assert.match(panel, /\["recovery","invite"\]\.includes\(type\)/);
  assert.match(panel, /detectPasswordSetup\(\);/);
  assert.match(panel, /bootstrapOwner\(value\("owner-full-name"\)\)/);
  assert.match(config, /enable_signup\s*=\s*false/);
});
