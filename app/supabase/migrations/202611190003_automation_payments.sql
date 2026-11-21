-- Desenrola Fácil | Fase 2 | filas duráveis e referências de pagamento
-- Nenhum segredo, payload bruto ou dado real de cliente é inserido.
begin;

create table if not exists public.automation_jobs (
  id uuid primary key default gen_random_uuid(),
  provider text not null check (provider in ('whatsapp_cloud','instagram_graph','asaas')),
  job_type text not null check (job_type in ('incoming_message','payment_reconcile')),
  external_event_id text not null,
  event_hash text,
  contact_id uuid references public.contacts(id) on delete set null,
  thread_id uuid references public.conversation_threads(id) on delete set null,
  conversation_event_id uuid references public.conversation_events(id) on delete set null,
  sale_id uuid references public.sales(id) on delete set null,
  status text not null default 'queued'
    check (status in ('queued','processing','completed','retrying','failed','ignored')),
  attempts smallint not null default 0 check (attempts >= 0),
  run_after timestamptz not null default now(),
  safe_error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider,job_type,external_event_id)
);

create table if not exists public.payment_customers (
  id uuid primary key default gen_random_uuid(),
  provider text not null check (provider in ('asaas')),
  contact_id uuid not null references public.contacts(id) on delete restrict,
  external_customer_id text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider,contact_id),
  unique (provider,external_customer_id)
);

create table if not exists public.payment_sessions (
  id uuid primary key default gen_random_uuid(),
  sale_id uuid not null references public.sales(id) on delete restrict,
  provider text not null check (provider in ('asaas')),
  checkout_request_id uuid,
  external_charge_id text,
  checkout_url text,
  status text not null default 'pending'
    check (status in ('pending','confirmed','overdue','cancelled','refunded','failed')),
  amount numeric(12,2) not null check (amount >= 0),
  currency char(3) not null default 'BRL',
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider,external_charge_id)
);

create index if not exists automation_jobs_status_run_after_idx
  on public.automation_jobs(status,run_after,created_at);
create index if not exists payment_sessions_sale_idx
  on public.payment_sessions(sale_id,created_at desc);
alter table public.payment_sessions add column if not exists checkout_request_id uuid;
create unique index if not exists payment_sessions_sale_provider_uidx
  on public.payment_sessions(sale_id,provider);
create unique index if not exists payment_sessions_checkout_request_uidx
  on public.payment_sessions(checkout_request_id) where checkout_request_id is not null;

-- Race-safe creation/linking for inbound identities. Only signed webhook code may call this.
create or replace function public.resolve_channel_contact(
  p_channel text,
  p_provider_account_id text,
  p_external_user_id text,
  p_display_name text default null,
  p_phone text default null
)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  actor_role text := coalesce(auth.jwt() ->> 'role','');
  contact_uuid uuid;
begin
  if actor_role <> 'service_role' then
    raise exception 'Channel identity resolution is server-only' using errcode = '42501';
  end if;
  if p_channel is null or p_channel not in ('whatsapp','instagram')
     or length(btrim(coalesce(p_provider_account_id,''))) not between 1 and 200
     or length(btrim(coalesce(p_external_user_id,''))) not between 1 and 200
     or (p_display_name is not null and length(p_display_name) > 160)
     or (p_phone is not null and length(p_phone) > 40) then
    raise exception 'Invalid channel identity' using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_channel || ':' || p_provider_account_id || ':' || p_external_user_id,0)
  );
  select ci.contact_id into contact_uuid from public.channel_identities ci
    where ci.channel=p_channel and ci.provider_account_id=p_provider_account_id
      and ci.external_user_id=p_external_user_id;
  if contact_uuid is not null then return contact_uuid; end if;

  insert into public.contacts(full_name,phone,source,lifecycle_stage,marketing_consent)
  values (
    coalesce(nullif(btrim(p_display_name),''),initcap(p_channel) || ' lead ' || right(p_external_user_id,4)),
    nullif(btrim(p_phone),''),p_channel,'lead',false
  ) returning id into contact_uuid;

  insert into public.channel_identities(contact_id,channel,provider_account_id,external_user_id,display_handle)
  values (contact_uuid,p_channel,p_provider_account_id,p_external_user_id,
    case when p_channel='instagram' then nullif(btrim(p_display_name),'') else null end);
  return contact_uuid;
end
$$;

revoke all on function public.resolve_channel_contact(text,text,text,text,text) from public,anon,authenticated;
grant execute on function public.resolve_channel_contact(text,text,text,text,text) to service_role;

-- Reserve exactly one sandbox checkout per sale. A request that loses its
-- response can inspect/reconcile the existing reservation instead of creating
-- a duplicate charge. The API key never reaches this database function.
create or replace function public.reserve_asaas_payment_session(p_sale_id uuid, p_request_id uuid)
returns public.payment_sessions
language plpgsql security definer set search_path = ''
as $$
declare
  actor_role text := coalesce(auth.jwt() ->> 'role','');
  sale_row public.sales%rowtype;
  session_row public.payment_sessions%rowtype;
begin
  if actor_role <> 'service_role' then
    raise exception 'Payment reservation is server-only' using errcode = '42501';
  end if;
  if p_request_id is null then
    raise exception 'Checkout request id is required' using errcode = '22023';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_sale_id::text || ':asaas',0)
  );
  select * into sale_row from public.sales where id=p_sale_id for update;
  if not found or sale_row.status <> 'pending' then
    raise exception 'Only pending sales can start checkout' using errcode = '22023';
  end if;
  select * into session_row from public.payment_sessions
    where sale_id=p_sale_id and provider='asaas' for update;
  if found then return session_row; end if;
  insert into public.payment_sessions(sale_id,provider,amount,checkout_request_id)
    values (p_sale_id,'asaas',sale_row.amount,p_request_id) returning * into session_row;
  return session_row;
end
$$;
revoke all on function public.reserve_asaas_payment_session(uuid,uuid) from public,anon,authenticated;
grant execute on function public.reserve_asaas_payment_session(uuid,uuid) to service_role;

create trigger automation_jobs_updated_at before update on public.automation_jobs
for each row execute function app_private.set_updated_at();
create trigger payment_customers_updated_at before update on public.payment_customers
for each row execute function app_private.set_updated_at();
create trigger payment_sessions_updated_at before update on public.payment_sessions
for each row execute function app_private.set_updated_at();

alter table public.automation_jobs enable row level security;
alter table public.payment_customers enable row level security;
alter table public.payment_sessions enable row level security;

revoke all on table public.automation_jobs,public.payment_customers,public.payment_sessions from anon,authenticated;
grant select on public.payment_sessions to authenticated;
grant select,insert,update,delete on public.automation_jobs,public.payment_customers,public.payment_sessions to service_role;

create policy payment_sessions_read_finance_commercial on public.payment_sessions
for select to authenticated
using (app_private.has_any_role(array['owner','admin','finance','commercial']));

commit;
