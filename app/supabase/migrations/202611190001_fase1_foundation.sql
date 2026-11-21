-- Desenrola Fácil | Fase 1 | PostgreSQL / Supabase
-- No customer data is seeded. The auth adapter is the only Supabase-specific part.
begin;
create schema if not exists app_private;
revoke all on schema app_private from public, anon;
grant usage on schema app_private to authenticated, service_role;

create table if not exists public.profiles (
  id uuid primary key,
  full_name text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.user_roles (
  user_id uuid not null references public.profiles(id) on delete cascade,
  role text not null check (role in ('owner','admin','commercial','finance','facilitator','read_only')),
  assigned_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (user_id, role)
);
create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  category text not null check (category in ('mentoria','livro','constelacao','vivencia','outro')),
  description text not null default '',
  price numeric(12,2) not null check (price >= 0),
  currency char(3) not null default 'BRL',
  delivery_mode text not null check (delivery_mode in ('online','presencial','hibrido','editorial')),
  format text not null default '',
  duration_text text,
  active boolean not null default true,
  extra jsonb not null default '{}'::jsonb check (jsonb_typeof(extra) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.contacts (
  id uuid primary key default gen_random_uuid(),
  full_name text not null, email text, phone text,
  source text not null default 'manual',
  lifecycle_stage text not null default 'lead'
    check (lifecycle_stage in ('lead','qualified','customer','former_customer','disqualified')),
  interest_code text references public.products(code) on update cascade on delete set null,
  marketing_consent boolean not null default false,
  consent_recorded_at timestamptz,
  assigned_to uuid references public.profiles(id) on delete set null,
  notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (email is null or length(email) <= 320),
  check (phone is null or length(phone) <= 40)
);
create table if not exists public.opportunities (
  id uuid primary key default gen_random_uuid(),
  contact_id uuid not null references public.contacts(id) on delete restrict,
  product_id uuid references public.products(id) on delete set null,
  stage text not null default 'new'
    check (stage in ('new','contacted','qualified','offer_presented','negotiation','won','lost','nurture')),
  expected_value numeric(12,2) check (expected_value is null or expected_value >= 0),
  next_follow_up_at timestamptz,
  owner_id uuid references public.profiles(id) on delete set null,
  lost_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.conversation_events (
  id uuid primary key default gen_random_uuid(),
  contact_id uuid not null references public.contacts(id) on delete cascade,
  channel text not null check (channel in ('instagram','whatsapp','email','site','phone','internal')),
  direction text not null check (direction in ('inbound','outbound','internal')),
  body text not null default '',
  external_event_id text,
  occurred_at timestamptz not null default now(),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create table if not exists public.sales (
  id uuid primary key default gen_random_uuid(),
  contact_id uuid not null references public.contacts(id) on delete restrict,
  product_id uuid not null references public.products(id) on delete restrict,
  opportunity_id uuid references public.opportunities(id) on delete set null,
  status text not null default 'pending' check (status in ('pending','confirmed','cancelled','refunded')),
  amount numeric(12,2) not null check (amount >= 0),
  payment_method text check (payment_method is null or payment_method in ('pix','card','other')),
  installments smallint check (installments is null or installments between 1 and 48),
  payment_reference text,
  payment_confirmed_at timestamptz,
  payment_confirmed_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((status <> 'confirmed') or payment_confirmed_at is not null)
);
create table if not exists public.finance_entries (
  id uuid primary key default gen_random_uuid(),
  sale_id uuid references public.sales(id) on delete set null,
  entry_type text not null check (entry_type in ('income','expense')),
  status text not null default 'pending' check (status in ('pending','confirmed','cancelled')),
  description text not null, amount numeric(12,2) not null check (amount >= 0),
  due_at date, settled_at timestamptz,
  payment_method text check (payment_method is null or payment_method in ('pix','card','cash','transfer','other')),
  category text not null default 'uncategorized',
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((status <> 'confirmed') or settled_at is not null)
);
create table if not exists public.appointments (
  id uuid primary key default gen_random_uuid(),
  contact_id uuid references public.contacts(id) on delete set null,
  appointment_type text not null check (appointment_type in ('mentoria','constelacao','vivencia','reuniao','outro')),
  title text not null, starts_at timestamptz not null, ends_at timestamptz not null,
  status text not null default 'scheduled' check (status in ('scheduled','completed','cancelled','no_show')),
  location text not null default '', operational_notes text not null default '',
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at > starts_at)
);
create table if not exists public.mentorship_enrollments (
  id uuid primary key default gen_random_uuid(),
  sale_id uuid not null unique references public.sales(id) on delete restrict,
  contact_id uuid not null references public.contacts(id) on delete restrict,
  product_id uuid not null references public.products(id) on delete restrict,
  status text not null default 'pending_payment'
    check (status in ('pending_payment','active','completed','cancelled')),
  started_at timestamptz, ends_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at is null or started_at is null or ends_at > started_at)
);
create table if not exists public.experiences (
  id uuid primary key default gen_random_uuid(),
  code text not null unique, name text not null, description text not null default '',
  location text not null default '', starts_at timestamptz, ends_at timestamptz,
  status text not null check (status in ('draft','planned','completed','cancelled')),
  price numeric(12,2) check (price is null or price >= 0),
  capacity integer check (capacity is null or capacity >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at is null or starts_at is null or ends_at > starts_at)
);
create table if not exists public.experience_registrations (
  id uuid primary key default gen_random_uuid(),
  experience_id uuid not null references public.experiences(id) on delete restrict,
  contact_id uuid not null references public.contacts(id) on delete restrict,
  sale_id uuid references public.sales(id) on delete set null,
  status text not null default 'pending_payment'
    check (status in ('pending_payment','confirmed','attended','cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (experience_id, contact_id)
);
-- Store identifiers/secret references only; never store credentials here.
create table if not exists public.integration_settings (
  id uuid primary key default gen_random_uuid(),
  provider text not null unique check (provider in ('whatsapp_cloud','instagram_graph','asaas')),
  status text not null default 'not_configured'
    check (status in ('not_configured','sandbox','configured','disabled')),
  public_config jsonb not null default '{}'::jsonb check (jsonb_typeof(public_config) = 'object'),
  secret_reference text,
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- Diagnostic and idempotency metadata only; no raw webhook/message payload.
create table if not exists public.integration_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null check (provider in ('whatsapp_cloud','instagram_graph','asaas')),
  external_event_id text not null, event_type text not null,
  processing_status text not null default 'received'
    check (processing_status in ('received','processed','retrying','failed','ignored')),
  attempts smallint not null default 0 check (attempts >= 0),
  safe_error_code text, received_at timestamptz not null default now(), processed_at timestamptz,
  unique (provider, external_event_id)
);
create table if not exists public.audit_log (
  id bigint generated always as identity primary key,
  entity text not null, record_id uuid not null,
  action text not null check (action in ('INSERT','UPDATE','DELETE')),
  changed_fields text[] not null default '{}',
  actor_user_id uuid, occurred_at timestamptz not null default now()
);

create index if not exists contacts_created_at_idx on public.contacts(created_at desc);
create index if not exists contacts_stage_idx on public.contacts(lifecycle_stage);
create index if not exists contacts_assigned_to_idx on public.contacts(assigned_to);
create index if not exists opportunities_stage_followup_idx on public.opportunities(stage,next_follow_up_at);
create index if not exists opportunities_contact_idx on public.opportunities(contact_id);
create index if not exists conversations_contact_time_idx on public.conversation_events(contact_id,occurred_at desc);
create index if not exists sales_status_created_idx on public.sales(status,created_at desc);
create index if not exists finance_status_due_idx on public.finance_entries(status,due_at);
create index if not exists appointments_start_idx on public.appointments(starts_at);
create index if not exists integration_events_status_idx on public.integration_events(processing_status,received_at);
create index if not exists audit_log_entity_time_idx on public.audit_log(entity,occurred_at desc);

-- Replace this single adapter when moving the schema to a different auth provider.
create or replace function app_private.current_actor_id()
returns uuid language sql stable security invoker set search_path = ''
as $$ select auth.uid() $$;
create or replace function app_private.has_any_role(allowed_roles text[])
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.user_roles ur
    where ur.user_id = app_private.current_actor_id() and ur.role = any (allowed_roles)
  )
$$;
revoke all on function app_private.current_actor_id() from public;
revoke all on function app_private.has_any_role(text[]) from public;
grant execute on function app_private.current_actor_id() to authenticated, service_role;
grant execute on function app_private.has_any_role(text[]) to authenticated, service_role;

create or replace function app_private.set_updated_at()
returns trigger language plpgsql set search_path = ''
as $$ begin new.updated_at := now(); return new; end $$;

create or replace function app_private.guard_sale_confirmation()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare actor_role text := coalesce(auth.jwt() ->> 'role',''); status_changed boolean := false;
begin
  if tg_op = 'INSERT' then
    status_changed := new.status = 'confirmed';
  else
    status_changed := new.status = 'confirmed' and old.status is distinct from 'confirmed';
  end if;
  if status_changed then
    if actor_role <> 'service_role'
       and not app_private.has_any_role(array['owner','admin','finance']) then
      raise exception 'Payment confirmation requires finance/admin authorization' using errcode = '42501';
    end if;
    new.payment_confirmed_at := coalesce(new.payment_confirmed_at,now());
    new.payment_confirmed_by := app_private.current_actor_id();
  end if;
  if tg_op = 'UPDATE' and new.status <> 'confirmed' and old.status = 'confirmed'
     and actor_role <> 'service_role'
     and not app_private.has_any_role(array['owner','admin','finance']) then
    raise exception 'Changing a confirmed payment requires finance/admin authorization' using errcode = '42501';
  end if;
  return new;
end
$$;

-- Audit field names, never values, so changes can be traced without duplicating PII.
create or replace function app_private.guard_paid_enrollment()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare linked_status text;
begin
  if new.status in ('active','completed','confirmed','attended') then
    select status into linked_status from public.sales where id = new.sale_id;
    if linked_status is distinct from 'confirmed' then
      raise exception 'Enrollment requires a confirmed payment' using errcode = '42501';
    end if;
  end if;
  return new;
end
$$;

-- Atomic sale + receivable creation. The caller supplies identifiers only; price comes from the active catalog.
create or replace function public.create_sale_with_receivable(
  p_contact_id uuid,
  p_product_id uuid,
  p_payment_method text default null,
  p_installments smallint default null,
  p_opportunity_id uuid default null
)
returns public.sales
language plpgsql security definer set search_path = ''
as $$
declare
  actor_role text := coalesce(auth.jwt() ->> 'role','');
  product_row public.products%rowtype;
  sale_row public.sales%rowtype;
begin
  if actor_role <> 'service_role'
     and not app_private.has_any_role(array['owner','admin','commercial']) then
    raise exception 'Sale creation requires commercial authorization' using errcode = '42501';
  end if;
  if p_payment_method is not null and p_payment_method not in ('pix','card','other') then
    raise exception 'Invalid payment method' using errcode = '22023';
  end if;
  if p_installments is not null and p_installments not between 1 and 48 then
    raise exception 'Invalid installment count' using errcode = '22023';
  end if;

  select * into product_row from public.products
    where id = p_product_id and active = true for share;
  if not found then
    raise exception 'Active product not found' using errcode = '22023';
  end if;
  if p_opportunity_id is not null and not exists (
    select 1 from public.opportunities o
    where o.id=p_opportunity_id and o.contact_id=p_contact_id
      and (o.product_id is null or o.product_id=product_row.id)
  ) then
    raise exception 'Opportunity does not match contact and product' using errcode = '22023';
  end if;

  insert into public.sales(contact_id,product_id,opportunity_id,status,amount,payment_method,installments)
  values (p_contact_id,product_row.id,p_opportunity_id,'pending',product_row.price,p_payment_method,p_installments)
  returning * into sale_row;

  insert into public.finance_entries(sale_id,entry_type,status,description,amount,due_at,payment_method,category,created_by)
  values (sale_row.id,'income','pending','Venda ' || sale_row.id::text || ' — ' || product_row.name,
    sale_row.amount,current_date,p_payment_method,'sales',app_private.current_actor_id());

  return sale_row;
end
$$;

-- Confirmation is an explicit finance action or a server call after provider verification.
create or replace function public.confirm_sale_receipt(
  p_sale_id uuid,
  p_payment_reference text default null,
  p_funds_available boolean default true
)
returns public.sales
language plpgsql security definer set search_path = ''
as $$
declare
  actor_role text := coalesce(auth.jwt() ->> 'role','');
  sale_row public.sales%rowtype;
begin
  if actor_role <> 'service_role'
     and not app_private.has_any_role(array['owner','admin','finance']) then
    raise exception 'Payment confirmation requires finance/admin authorization' using errcode = '42501';
  end if;
  if p_payment_reference is not null and length(btrim(p_payment_reference)) > 200 then
    raise exception 'Invalid payment reference' using errcode = '22023';
  end if;

  select * into sale_row from public.sales where id = p_sale_id for update;
  if not found then
    raise exception 'Sale not found' using errcode = '22023';
  end if;
  if sale_row.status in ('cancelled','refunded') then
    raise exception 'Cancelled or refunded sales cannot be confirmed' using errcode = '22023';
  end if;
  if sale_row.status <> 'confirmed' then
    update public.sales set status='confirmed', payment_reference=coalesce(nullif(btrim(p_payment_reference),''),payment_reference)
      where id=p_sale_id returning * into sale_row;
  elsif p_payment_reference is not null then
    update public.sales set payment_reference=nullif(btrim(p_payment_reference),'')
      where id=p_sale_id returning * into sale_row;
  end if;

  if p_funds_available then
    update public.finance_entries set status='confirmed', settled_at=coalesce(settled_at,now())
      where sale_id=p_sale_id and entry_type='income' and status='pending';
  end if;
  update public.mentorship_enrollments set status='active', started_at=coalesce(started_at,now())
    where sale_id=p_sale_id and status='pending_payment';
  update public.experience_registrations set status='confirmed'
    where sale_id=p_sale_id and status='pending_payment';

  return sale_row;
end
$$;

revoke all on function public.create_sale_with_receivable(uuid,uuid,text,smallint,uuid) from public, anon;
revoke all on function public.confirm_sale_receipt(uuid,text,boolean) from public, anon;
grant execute on function public.create_sale_with_receivable(uuid,uuid,text,smallint,uuid) to authenticated, service_role;
grant execute on function public.confirm_sale_receipt(uuid,text,boolean) to authenticated, service_role;

create or replace function app_private.write_audit_log()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare old_json jsonb := '{}'::jsonb; new_json jsonb := '{}'::jsonb;
        row_id uuid; fields text[] := '{}';
begin
  if tg_op in ('UPDATE','DELETE') then old_json := to_jsonb(old); end if;
  if tg_op in ('INSERT','UPDATE') then new_json := to_jsonb(new); end if;
  row_id := coalesce(new_json ->> 'id',old_json ->> 'id')::uuid;
  if tg_op = 'DELETE' then
    select coalesce(array_agg(key order by key),'{}')
      into fields from jsonb_object_keys(old_json) as keys(key);
  else
    select coalesce(array_agg(n.key order by n.key),'{}') into fields
      from jsonb_each(new_json) n left join jsonb_each(old_json) o on o.key=n.key
      where n.value is distinct from o.value;
  end if;
  insert into public.audit_log(entity,record_id,action,changed_fields,actor_user_id)
  values (tg_table_name,row_id,tg_op,fields,app_private.current_actor_id());
  if tg_op = 'DELETE' then return old; end if;
  return new;
end
$$;

do $$
declare t text;
begin
  foreach t in array array['profiles','products','contacts','opportunities','sales','finance_entries',
    'appointments','mentorship_enrollments','experiences','experience_registrations','integration_settings']
  loop
    execute format('create trigger %I before update on public.%I for each row execute function app_private.set_updated_at()',t||'_updated_at',t);
  end loop;
end $$;
create trigger sales_confirmation_guard before insert or update on public.sales
for each row execute function app_private.guard_sale_confirmation();
create trigger mentorship_paid_guard before insert or update on public.mentorship_enrollments
for each row execute function app_private.guard_paid_enrollment();
create trigger experience_registration_paid_guard before insert or update on public.experience_registrations
for each row execute function app_private.guard_paid_enrollment();
do $$
declare t text;
begin
  foreach t in array array['products','contacts','opportunities','sales','finance_entries','appointments',
    'mentorship_enrollments','experiences','experience_registrations']
  loop
    execute format('create trigger %I after insert or update or delete on public.%I for each row execute function app_private.write_audit_log()','audit_'||t,t);
  end loop;
end $$;

alter table public.profiles enable row level security;
alter table public.user_roles enable row level security;
alter table public.products enable row level security;
alter table public.contacts enable row level security;
alter table public.opportunities enable row level security;
alter table public.conversation_events enable row level security;
alter table public.sales enable row level security;
alter table public.finance_entries enable row level security;
alter table public.appointments enable row level security;
alter table public.mentorship_enrollments enable row level security;
alter table public.experiences enable row level security;
alter table public.experience_registrations enable row level security;
alter table public.integration_settings enable row level security;
alter table public.integration_events enable row level security;
alter table public.audit_log enable row level security;

grant usage on schema public to authenticated, service_role;
revoke all on table public.profiles, public.user_roles, public.products, public.contacts,
  public.opportunities, public.conversation_events, public.sales, public.finance_entries,
  public.appointments, public.mentorship_enrollments, public.experiences,
  public.experience_registrations, public.integration_settings, public.integration_events,
  public.audit_log from anon, authenticated;
grant select,update on public.profiles to authenticated;
grant select on public.user_roles to authenticated;
grant select,insert,update,delete on public.products,public.contacts,public.opportunities,
  public.conversation_events,public.sales,public.finance_entries,public.appointments,
  public.mentorship_enrollments,public.experiences,public.experience_registrations,
  public.integration_settings to authenticated;
grant select on public.integration_events,public.audit_log to authenticated;
grant select,insert,update,delete on public.profiles,public.user_roles,public.products,
  public.contacts,public.opportunities,public.conversation_events,public.sales,
  public.finance_entries,public.appointments,public.mentorship_enrollments,public.experiences,
  public.experience_registrations,public.integration_settings,public.integration_events,
  public.audit_log to service_role;

create policy profiles_read on public.profiles for select to authenticated
using (id=app_private.current_actor_id() or app_private.has_any_role(array['owner','admin']));
create policy profiles_update_self on public.profiles for update to authenticated
using (id=app_private.current_actor_id()) with check (id=app_private.current_actor_id());
create policy user_roles_read_self_admin on public.user_roles for select to authenticated
using (user_id=app_private.current_actor_id() or app_private.has_any_role(array['owner','admin']));

create policy products_read_staff on public.products for select to authenticated
using (app_private.has_any_role(array['owner','admin','commercial','finance','facilitator','read_only']));
create policy products_write_admin on public.products for all to authenticated
using (app_private.has_any_role(array['owner','admin']))
with check (app_private.has_any_role(array['owner','admin']));

create policy contacts_read_authorized on public.contacts for select to authenticated
using (app_private.has_any_role(array['owner','admin','commercial','finance']));
create policy contacts_insert_commercial on public.contacts for insert to authenticated
with check (app_private.has_any_role(array['owner','admin','commercial']));
create policy contacts_update_commercial on public.contacts for update to authenticated
using (app_private.has_any_role(array['owner','admin','commercial']))
with check (app_private.has_any_role(array['owner','admin','commercial']));
create policy contacts_delete_owner on public.contacts for delete to authenticated
using (app_private.has_any_role(array['owner']));

create policy opportunities_read_commercial on public.opportunities for select to authenticated
using (app_private.has_any_role(array['owner','admin','commercial']));
create policy opportunities_write_commercial on public.opportunities for insert to authenticated
with check (app_private.has_any_role(array['owner','admin','commercial']));
create policy opportunities_update_commercial on public.opportunities for update to authenticated
using (app_private.has_any_role(array['owner','admin','commercial']))
with check (app_private.has_any_role(array['owner','admin','commercial']));
create policy opportunities_delete_admin on public.opportunities for delete to authenticated
using (app_private.has_any_role(array['owner','admin']));

create policy conversations_read_commercial on public.conversation_events for select to authenticated
using (app_private.has_any_role(array['owner','admin','commercial']));
create policy conversations_insert_commercial on public.conversation_events for insert to authenticated
with check (app_private.has_any_role(array['owner','admin','commercial']));
create policy conversations_update_admin on public.conversation_events for update to authenticated
using (app_private.has_any_role(array['owner','admin']))
with check (app_private.has_any_role(array['owner','admin']));

create policy sales_read_authorized on public.sales for select to authenticated
using (app_private.has_any_role(array['owner','admin','commercial','finance']));
create policy sales_insert_commercial on public.sales for insert to authenticated
with check (app_private.has_any_role(array['owner','admin','commercial']) and status='pending');
create policy sales_update_finance on public.sales for update to authenticated
using (app_private.has_any_role(array['owner','admin','finance']))
with check (app_private.has_any_role(array['owner','admin','finance']));
create policy sales_delete_admin on public.sales for delete to authenticated
using (app_private.has_any_role(array['owner','admin']));

create policy finance_read_finance on public.finance_entries for select to authenticated
using (app_private.has_any_role(array['owner','admin','finance']));
create policy finance_insert_finance on public.finance_entries for insert to authenticated
with check (app_private.has_any_role(array['owner','admin','finance']));
create policy finance_update_finance on public.finance_entries for update to authenticated
using (app_private.has_any_role(array['owner','admin','finance']))
with check (app_private.has_any_role(array['owner','admin','finance']));
create policy finance_delete_owner on public.finance_entries for delete to authenticated
using (app_private.has_any_role(array['owner']));

create policy appointments_read_team on public.appointments for select to authenticated
using (app_private.has_any_role(array['owner','admin','commercial','facilitator']));
create policy appointments_insert_team on public.appointments for insert to authenticated
with check (app_private.has_any_role(array['owner','admin','commercial']));
create policy appointments_update_team on public.appointments for update to authenticated
using (app_private.has_any_role(array['owner','admin','commercial','facilitator']))
with check (app_private.has_any_role(array['owner','admin','commercial','facilitator']));
create policy appointments_delete_admin on public.appointments for delete to authenticated
using (app_private.has_any_role(array['owner','admin']));

create policy mentorships_read_team on public.mentorship_enrollments for select to authenticated
using (app_private.has_any_role(array['owner','admin','commercial','facilitator']));
create policy mentorships_insert_commercial on public.mentorship_enrollments for insert to authenticated
with check (app_private.has_any_role(array['owner','admin','commercial']));
create policy mentorships_update_team on public.mentorship_enrollments for update to authenticated
using (app_private.has_any_role(array['owner','admin','commercial','facilitator']))
with check (app_private.has_any_role(array['owner','admin','commercial','facilitator']));
create policy mentorships_delete_admin on public.mentorship_enrollments for delete to authenticated
using (app_private.has_any_role(array['owner','admin']));

create policy experiences_read_team on public.experiences for select to authenticated
using (app_private.has_any_role(array['owner','admin','commercial','facilitator','read_only']));
create policy experiences_write_admin on public.experiences for all to authenticated
using (app_private.has_any_role(array['owner','admin']))
with check (app_private.has_any_role(array['owner','admin']));
create policy experience_registrations_read_team on public.experience_registrations for select to authenticated
using (app_private.has_any_role(array['owner','admin','commercial','facilitator']));
create policy experience_registrations_insert_commercial on public.experience_registrations for insert to authenticated
with check (app_private.has_any_role(array['owner','admin','commercial']));
create policy experience_registrations_update_team on public.experience_registrations for update to authenticated
using (app_private.has_any_role(array['owner','admin','commercial','facilitator']))
with check (app_private.has_any_role(array['owner','admin','commercial','facilitator']));

create policy integrations_read_admin on public.integration_settings for select to authenticated
using (app_private.has_any_role(array['owner','admin']));
create policy integrations_write_admin on public.integration_settings for all to authenticated
using (app_private.has_any_role(array['owner','admin']))
with check (app_private.has_any_role(array['owner','admin']));
create policy integration_events_read_admin on public.integration_events for select to authenticated
using (app_private.has_any_role(array['owner','admin']));
create policy audit_read_admin on public.audit_log for select to authenticated
using (app_private.has_any_role(array['owner','admin']));

commit;

