-- Desenrola Fácil | Fase 1 | Preparação Meta Messaging (sem conexão ativa)
-- Nenhum token, webhook, conta Meta ou payload real é inserido.

begin;

create table if not exists public.conversation_threads (
  id uuid primary key default gen_random_uuid(),
  contact_id uuid not null references public.contacts(id) on delete restrict,
  channel text not null check (channel in ('whatsapp','instagram')),
  provider_account_id text not null,
  external_conversation_id text not null,
  control_state text not null default 'automation'
    check (control_state in ('automation','human_requested','human_assigned','waiting_customer','closed','provider_owned')),
  handoff_reason text,
  assigned_to uuid references public.profiles(id) on delete set null,
  last_message_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (channel,provider_account_id,external_conversation_id)
);

create table if not exists public.channel_identities (
  id uuid primary key default gen_random_uuid(),
  contact_id uuid not null references public.contacts(id) on delete restrict,
  channel text not null check (channel in ('whatsapp','instagram')),
  provider_account_id text not null,
  external_user_id text not null,
  display_handle text,
  linked_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (channel,provider_account_id,external_user_id)
);

create table if not exists public.communication_consents (
  id uuid primary key default gen_random_uuid(),
  contact_id uuid not null references public.contacts(id) on delete restrict,
  channel text not null check (channel in ('whatsapp','instagram','email','sms')),
  purpose text not null check (purpose in ('service','marketing')),
  state text not null check (state in ('granted','revoked')),
  source text not null,
  evidence_reference text,
  captured_by uuid references public.profiles(id) on delete set null,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create table if not exists public.meta_oauth_states (
  state_hash text primary key check (state_hash ~ '^[a-f0-9]{64}$'),
  provider text not null check (provider in ('whatsapp_cloud','instagram_graph')),
  initiated_by uuid references public.profiles(id) on delete set null,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.conversation_events
  add column if not exists thread_id uuid references public.conversation_threads(id) on delete set null,
  add column if not exists actor_type text not null default 'system'
    check (actor_type in ('customer','human','automation','system')),
  add column if not exists delivery_status text not null default 'unknown'
    check (delivery_status in ('received','queued','sent','delivered','read','failed','unknown')),
  add column if not exists safe_metadata jsonb not null default '{}'::jsonb
    check (jsonb_typeof(safe_metadata) = 'object');

alter table public.integration_events
  add column if not exists provider_account_id text,
  add column if not exists event_hash text,
  add column if not exists last_attempt_at timestamptz,
  add column if not exists next_attempt_at timestamptz;

create unique index if not exists conversation_event_platform_dedupe_idx
  on public.conversation_events(channel,external_event_id)
  where external_event_id is not null;
create index if not exists conversation_threads_contact_recent_idx
  on public.conversation_threads(contact_id,last_message_at desc);
create index if not exists conversation_threads_handoff_idx
  on public.conversation_threads(control_state,last_message_at);
create index if not exists channel_identities_contact_idx
  on public.channel_identities(contact_id);
create index if not exists communication_consents_contact_time_idx
  on public.communication_consents(contact_id,occurred_at desc);
create index if not exists integration_events_retry_idx
  on public.integration_events(processing_status,next_attempt_at);

create trigger conversation_threads_updated_at before update on public.conversation_threads
for each row execute function app_private.set_updated_at();
create trigger audit_conversation_threads after insert or update or delete on public.conversation_threads
for each row execute function app_private.write_audit_log();

alter table public.conversation_threads enable row level security;
alter table public.channel_identities enable row level security;
alter table public.communication_consents enable row level security;
alter table public.meta_oauth_states enable row level security;

revoke all on public.conversation_threads,public.channel_identities,
  public.communication_consents,public.meta_oauth_states from anon,authenticated;
grant select,insert,update,delete on public.conversation_threads to authenticated;
grant select on public.channel_identities to authenticated;
grant select,insert on public.communication_consents to authenticated;
grant select,insert,update,delete on public.conversation_threads,public.channel_identities,
  public.communication_consents,public.meta_oauth_states to service_role;

create policy conversation_threads_read_commercial on public.conversation_threads
for select to authenticated
using (app_private.has_any_role(array['owner','admin','commercial']));
create policy conversation_threads_insert_commercial on public.conversation_threads
for insert to authenticated
with check (app_private.has_any_role(array['owner','admin','commercial']));
create policy conversation_threads_update_commercial on public.conversation_threads
for update to authenticated
using (app_private.has_any_role(array['owner','admin','commercial']))
with check (app_private.has_any_role(array['owner','admin','commercial']));
create policy conversation_threads_delete_admin on public.conversation_threads
for delete to authenticated
using (app_private.has_any_role(array['owner','admin']));

create policy channel_identities_read_commercial on public.channel_identities
for select to authenticated
using (app_private.has_any_role(array['owner','admin','commercial']));

create policy communication_consents_read_commercial on public.communication_consents
for select to authenticated
using (app_private.has_any_role(array['owner','admin','commercial']));
create policy communication_consents_insert_commercial on public.communication_consents
for insert to authenticated
with check (app_private.has_any_role(array['owner','admin','commercial']));
-- Consent history is append-only for authenticated users; revocation is a new row.

-- OAuth state tokens are server-only; authenticated users cannot read or write them.
-- Webhook writes also use the server-only service_role. The table stores a hash, never raw state.
commit;

