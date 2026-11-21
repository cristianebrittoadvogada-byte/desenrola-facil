import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { encryptBytes, decryptBytes, assertRestoreTarget, RESTORE_DB_NAME, RESTORE_CONFIRM_TOKEN } from "../scripts/db-maintenance.mjs";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");
const migration = await read("../migrations/202611190001_fase1_foundation.sql");
const metaMigration = await read("../migrations/202611190002_meta_channels_foundation.sql");
const automationMigration = await read("../migrations/202611190003_automation_payments.sql");
const completionMigration = await read("../migrations/202611200001_business_completion.sql");
const contractsMigration = await read("../migrations/202611200002_contracts.sql");
const metaConsent = await read("../functions/meta-webhook/consent.mjs");
const seed = await read("../seed.sql");
const config = await read("../config.toml");
const api = await read("../functions/api/index.ts");
const web = await read("../web/app.js");
const webHtml = await read("../web/index.html");
const webConfig = await read("../web/app-config.js");
const metaWebhook = await read("../functions/meta-webhook/index.ts");
const paymentFunction = await read("../functions/payments/index.ts");
const asaasWebhook = await read("../functions/asaas-webhook/index.ts");
const css = await read("../web/styles.css");
const rlsSmoke = await read("./rls_smoke.sql");

test("migração cobre CRM, financeiro, agenda e integrações", () => {
  for (const table of ["profiles","user_roles","products","contacts","opportunities","sales","finance_entries","appointments","experiences","integration_events","audit_log"]) {
    assert.match(migration, new RegExp("create table if not exists public\\." + table + "\\b"));
  }
});

test("tabelas com dados ficam protegidas por RLS", () => {
  const tables = ["profiles","user_roles","products","contacts","opportunities","conversation_events","sales","finance_entries","appointments","mentorship_enrollments","experiences","experience_registrations","integration_settings","integration_events","audit_log"];
  for (const table of tables) assert.match(migration, new RegExp("alter table public\\." + table + " enable row level security"));
});

test("fundação Meta protege threads, identidades, consentimento e OAuth", () => {
  for (const table of ["conversation_threads","channel_identities","communication_consents","meta_oauth_states"]) {
    assert.match(metaMigration, new RegExp("create table if not exists public\\." + table + "\\b"));
    assert.match(metaMigration, new RegExp("alter table public\\." + table + " enable row level security"));
  }
  assert.doesNotMatch(metaMigration, /access_token\\s+text|app_secret\\s+text|raw_payload\\s+jsonb/i);
  assert.match(metaMigration, /unique \(channel,provider_account_id,external_user_id\)/);
  assert.match(metaMigration, /communication_consents_insert_commercial/);
  assert.doesNotMatch(metaMigration, /communication_consents_update_commercial|communication_consents_delete/);
});

test("cadastro público está desativado e API exige JWT", () => {
  assert.match(config, /enable_signup\s*=\s*false/);
  assert.match(config, /\[functions\.api\]\s*verify_jwt\s*=\s*true/);
  assert.match(api, /request\.headers\.get\("Authorization"\)/);
});

test("painel web está fixado na homologação com chave publicável e login restrito", () => {
  assert.ok(webConfig.includes("https://nmkneyzyxxhebkurgimh.supabase.co"));
  assert.ok(/key:\s*"sb_publishable_/.test(webConfig));
  assert.equal(/service_role|secret_key/i.test(webConfig), false);
  assert.ok(web.includes("window.DESENROLA_SUPABASE_CONFIG"));
  assert.ok(webHtml.includes('id="login-form"'));
  assert.equal(webHtml.includes('id="config-form"'), false);
});

test("seed contém somente teste fictício e pagamentos permanecem pendentes", () => {
  assert.match(seed, /example\.invalid/);
  assert.match(seed, /Contato Fictício de Homologação/);
  assert.match(seed, /'pending',3000\.00/);
  assert.doesNotMatch(seed, /'confirmed'/);
  assert.doesNotMatch(seed, /@gmail\.com|@outlook\.com|\+55\s*\d/);
});

test("venda não pode ser confirmada pelo papel comercial", () => {
  assert.match(migration, /guard_sale_confirmation/);
  assert.match(migration, /array\['owner','admin','finance'\]/);
  assert.match(migration, /Payment confirmation requires finance\/admin authorization/);
  assert.match(migration, /guard_paid_enrollment/);
  assert.match(migration, /Enrollment requires a confirmed payment/);
});

test("SQL não contém as falhas de delimitação encontradas na revisão", () => {
  assert.match(migration, /guard_paid_enrollment\(\)[\s\S]*?as \$\$[\s\S]*?end\s*\$\$;/);
  assert.match(metaMigration, /state_hash\s+text primary key check \(state_hash ~ '\^\[a-f0-9\]\{64\}\$'\)/);
  assert.equal((metaMigration.match(/\bcommit\s*;/gi) ?? []).length, 1);
  assert.match(metaMigration.trimEnd(), /\bcommit\s*;$/i);
});

test("permissões ficam limitadas às tabelas do módulo", () => {
  assert.doesNotMatch(migration, /\bon all tables in schema public\b|\bon all sequences in schema public\b|grant all privileges on all tables/i);
  assert.doesNotMatch(metaMigration, /grant all privileges/i);
  assert.match(migration, /revoke all on table public\.profiles[\s\S]*?from anon, authenticated/);
  assert.match(metaMigration, /revoke all on public\.conversation_threads[\s\S]*?from anon,authenticated/);
});

test("migrações não removem objetos nem dados", () => {
  for (const sql of [migration, metaMigration, automationMigration, completionMigration, contractsMigration]) {
    assert.doesNotMatch(sql, /\bdrop\s+(table|schema|database|role|policy|function|trigger)\b|\btruncate\b|\bdelete\s+from\b/i);
  }
});

test("RLS smoke SQL mantém o plano pgTAP alinhado com as verificações", () => {
  const plan = Number(rlsSmoke.match(/select plan\((\d+)\)/i)?.[1]);
  const assertions = [...rlsSmoke.matchAll(/^select (?:has_table|ok|is|lives_ok|throws_ok)\(/gim)].length;
  assert.equal(plan, assertions);
});

test("fila, pagamentos e identidades externas ficam fechados para o cliente", () => {
  for (const table of ["automation_jobs", "payment_customers", "payment_sessions"]) {
    assert.match(automationMigration, new RegExp("create table if not exists public\\." + table + "\\b"));
    assert.match(automationMigration, new RegExp("alter table public\\." + table + " enable row level security"));
  }
  assert.match(automationMigration, /unique \(provider,job_type,external_event_id\)/);
  assert.match(automationMigration, /payment_sessions_sale_provider_uidx/);
  assert.match(automationMigration, /checkout_request_id/);
  assert.match(automationMigration, /reserve_asaas_payment_session/);
  assert.match(automationMigration, /actor_role <> 'service_role'/);
  assert.match(automationMigration, /resolve_channel_contact/);
  assert.match(automationMigration, /actor_role <> 'service_role'/);
  assert.doesNotMatch(automationMigration, /asaas_api_key|access_token|raw_payload/i);
  assert.doesNotMatch(automationMigration, /on all tables|grant all privileges/i);
});

test("migração final fecha escrita direta em vendas e inclui onboarding seguro e métricas por perfil", () => {
  assert.match(completionMigration, /revoke insert, update, delete on public\.sales from authenticated/i);
  assert.match(completionMigration, /revoke insert, update, delete on public\.finance_entries from authenticated/i);
  assert.match(completionMigration, /grant insert \(entry_type, status, description, amount, due_at, payment_method, category, created_by\)/i);
  assert.match(completionMigration, /grant update \(status, settled_at\) on public\.finance_entries to authenticated/i);
  assert.match(completionMigration, /provision_company_user/);
  assert.match(completionMigration, /from public, anon, authenticated/);
  assert.match(completionMigration, /grant execute on function public\.provision_company_user[\s\S]*to service_role/i);
  assert.match(completionMigration, /get_dashboard_summary/);
  assert.match(completionMigration, /security invoker/);
  assert.match(completionMigration, /sync_confirmed_sale_business_state/);
  assert.match(completionMigration, /lifecycle_stage = 'customer'/);
  assert.match(completionMigration, /duration_months/);
  assert.match(completionMigration, /register_experience_participant/);
  assert.match(completionMigration, /communication_consents_explicit_message_uidx/);
  assert.match(completionMigration, /where evidence_reference is not null\s+and source = 'whatsapp_message_explicit_service_consent'/i);
  assert.match(metaConsent, /purpose:\s*"service"/);
  assert.match(metaConsent, /serviceContactConsent !== true/);
  assert.match(completionMigration, /capacity has been reached/i);
  assert.match(completionMigration, /revoke insert, update, delete on public\.experience_registrations from authenticated/i);
});

test("contratos ficam vinculados às vendas, auditados e com transições protegidas", () => {
  assert.match(contractsMigration.trimEnd(), /\bbegin\s*;[\s\S]*\bcommit\s*;$/i);
  assert.match(contractsMigration, /sale_id uuid not null unique references public\.sales\(id\) on delete restrict/);
  assert.match(contractsMigration, /alter table public\.contracts enable row level security/);
  assert.match(contractsMigration, /contracts_read_authorized/);
  assert.match(contractsMigration, /contracts_insert_commercial/);
  assert.match(contractsMigration, /grant insert \(sale_id,contract_text,created_by\) on public\.contracts to authenticated/i);
  assert.match(contractsMigration, /grant update \(contract_text,status\) on public\.contracts to authenticated/i);
  assert.match(contractsMigration, /contracts_state_guard/);
  assert.match(contractsMigration, /Only draft contract text can be edited/);
  assert.match(contractsMigration, /create trigger audit_contracts/);
  assert.match(contractsMigration, /status = 'signed' and sent_at is not null and signed_at is not null/);
});

test("painel usa contagens agregadas sem limite de paginação e permite reagendar follow-up", () => {
  assert.match(api, /rpc\("get_dashboard_summary"\)/);
  assert.match(api, /route === "\/v1\/followups"[\s\S]*?\.lte\("next_follow_up_at"/);
  assert.match(api, /\.not\("stage", "in", "\(won,lost\)"\)/);
  assert.match(web, /summary\.followups_due/);
  assert.match(web, /renderFollowups\(Array\.isArray\(cache\.followups\)/);
  assert.match(webHtml, /id="followups"/);
  assert.match(web, /next_follow_up_at:toIso\(followup\.value\)/);
  assert.match(webHtml, /id="product-duration-months"/);
});

test("venda e confirmação financeira são operações atômicas e autorizadas", () => {
  assert.match(migration, /create or replace function public\.create_sale_with_receivable/);
  assert.match(migration, /product_row\.price/);
  assert.match(migration, /insert into public\.finance_entries/);
  assert.match(migration, /create or replace function public\.confirm_sale_receipt/);
  assert.match(migration, /array\['owner','admin','finance'\]/);
  assert.match(migration, /update public\.mentorship_enrollments set status='active'/);
  assert.match(migration, /revoke all on function public\.confirm_sale_receipt/);
});

test("API oferece módulos centrais sem chave privilegiada no cliente", () => {
  for (const route of ["/v1/dashboard", "/v1/contacts", "/v1/opportunities", "/v1/sales", "/v1/contracts", "/v1/finance", "/v1/appointments", "/v1/mentorships", "/v1/experiences", "/v1/registrations", "/v1/threads", "/v1/conversations"]) {
    assert.ok(api.includes(route), `rota ausente: ${route}`);
  }
  assert.match(api, /rpc\("create_sale_with_receivable"/);
  assert.match(api, /rpc\("confirm_sale_receipt"/);
  assert.match(api, /rpc\("get_dashboard_summary"/);
  assert.match(api, /rpc\("register_experience_participant"/);
  assert.match(api, /sale_not_eligible_for_contract/);
  assert.match(api, /draft_contract_not_found/);
  assert.match(api, /invalid_contract_status/);
  assert.match(api, /safe_metadata,occurred_at/);
  assert.match(web, /safe_metadata\?\.campaign_source/);
  assert.match(web, /active:value\("product-active"\)==="true"/);
  assert.match(api, /optionalTimestamp/);
  assert.match(api, /parts\[1\] === "contacts"[\s\S]*parts\[3\] === "stage"/);
  assert.match(api, /\.is\("sale_id", null\)/);
  assert.doesNotMatch(api, /SERVICE_ROLE|service_role|localStorage/i);
});

test("RLS impede usuário autenticado sem função de ler CRM", () => {
  assert.match(migration, /contacts_read_authorized[\s\S]*commercial/);
  assert.match(migration, /Usuário Sem Permissão|contacts_read_authorized/);
});

test("interface não persiste token e adapta para celular", () => {
  assert.doesNotMatch(web, /localStorage/);
  assert.doesNotMatch(web, /service_role/i);
  assert.doesNotMatch(web, /sessionStorage\.setItem\(tokenKey/);
  assert.match(css, /@media\(max-width:560px\)/);
  for (const module of ["crm", "offers", "sales", "contracts", "finance", "agenda", "experiences", "conversations"]) assert.match(webHtml, new RegExp(`data-view=\\"${module}\\"`));
  const htmlIds = new Set([...webHtml.matchAll(/\bid="([^\"]+)"/g)].map((match) => match[1]));
  const scriptIds = new Set([...web.matchAll(/\$\("([^\"]+)"\)/g)].map((match) => match[1]));
  for (const id of scriptIds) assert.ok(htmlIds.has(id), `elemento ausente na interface: ${id}`);
});

test("webhook Meta exige HMAC, deduplica evento e não libera segredo service role ao provedor", () => {
  assert.match(config, /\[functions\.meta-webhook\]\s*verify_jwt\s*=\s*false/);
  assert.match(metaWebhook, /verifyMetaWebhookSignature/);
  assert.match(metaWebhook, /resolve_channel_contact/);
  assert.match(metaWebhook, /inbound/);
  assert.match(metaWebhook, /human_requested/);
  assert.match(metaWebhook, /provider_owned/);
  assert.match(metaWebhook, /24 \* 60 \* 60_000/);
  assert.match(metaWebhook, /Atendimento virtual Desenrola Fácil/);
  assert.match(metaWebhook, /nextFollowUpAt\(existingOpportunity\.next_follow_up_at\)/);
  assert.match(metaWebhook, /lifecycle_stage: "qualified"/);
  assert.match(metaWebhook, /campaign_source: event\.campaignSource/);
  assert.match(metaWebhook, /handoff_reason: event\.handoffReason/);
  assert.match(metaWebhook, /Meta sinalizou transferência humana/);
  assert.doesNotMatch(metaWebhook, /console\.(log|error)\(|JSON\.stringify\(payload\)/);
});

test("pagamentos ficam presos ao Sandbox e só reconciliam eventos recebidos pela API", () => {
  assert.match(config, /\[functions\.asaas-webhook\]\s*verify_jwt\s*=\s*false/);
  assert.match(config, /\[functions\.payments\]\s*verify_jwt\s*=\s*true/);
  assert.match(paymentFunction, /ASAAS_SANDBOX_API_KEY/);
  assert.match(paymentFunction, /validateTaxId/);
  assert.match(paymentFunction, /reserve_asaas_payment_session/);
  assert.match(paymentFunction, /isTrustedAsaasCheckoutUrl/);
  assert.match(asaasWebhook, /asaas-access-token/);
  assert.match(asaasWebhook, /confirm_sale_receipt/);
  assert.match(asaasWebhook, /p_funds_available: result\.fundsAvailable/);
  assert.match(paymentFunction, /status === 204 \? null : JSON\.stringify\(body\)/);
  assert.doesNotMatch(paymentFunction + asaasWebhook, /api\.asaas\.com\/v3(?!\/payments)/);
});

test("backup criptografado valida round trip, chave e integridade", () => {
  const key = Buffer.alloc(32, 7);
  const sample = Buffer.from("dump fictício; sem dados pessoais");
  const encrypted = encryptBytes(sample, key, Buffer.alloc(12, 9));
  assert.deepEqual(decryptBytes(encrypted, key), sample);
  assert.throws(() => decryptBytes(encrypted, Buffer.alloc(32, 8)));
  const tampered = Buffer.from(encrypted);
  tampered[20] ^= 1;
  assert.throws(() => decryptBytes(tampered, key));
});

test("restauração recusa qualquer banco diferente do nome isolado", () => {
  assert.throws(() => assertRestoreTarget({ PGDATABASE: "production", RESTORE_CONFIRM: RESTORE_CONFIRM_TOKEN }));
  assert.throws(() => assertRestoreTarget({ PGDATABASE: RESTORE_DB_NAME, RESTORE_CONFIRM: "wrong" }));
  assert.throws(() => assertRestoreTarget({ PGDATABASE: RESTORE_DB_NAME, PGHOST: 'db.remote.example', RESTORE_CONFIRM: RESTORE_CONFIRM_TOKEN }));
  assert.doesNotThrow(() => assertRestoreTarget({ PGDATABASE: RESTORE_DB_NAME, PGHOST: '127.0.0.1', RESTORE_CONFIRM: RESTORE_CONFIRM_TOKEN }));
});

