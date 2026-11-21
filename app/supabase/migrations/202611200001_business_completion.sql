-- Desenrola Fácil | Completa fluxo comercial, métricas e permissões de escrita.
-- A migração é aditiva; não remove tabelas, colunas ou dados.
begin;

alter table public.products
  add column if not exists duration_months smallint
    check (duration_months is null or duration_months between 1 and 120);

-- Idempotent evidence log for explicit service-contact consent received in a
-- WhatsApp message. The webhook stores no marketing consent from this marker.
create unique index if not exists communication_consents_explicit_message_uidx
  on public.communication_consents(contact_id,channel,purpose,evidence_reference)
  where evidence_reference is not null
    and source = 'whatsapp_message_explicit_service_consent';

-- Sales must be created and confirmed through guarded RPCs. Direct table writes
-- could otherwise bypass the atomic receivable and payment authorization.
revoke insert, update, delete on public.sales from authenticated;
grant select on public.sales to authenticated;

-- Keep manual finance entry creation, but prevent changing sale links, amounts,
-- descriptions, or ownership after creation through direct PostgREST updates.
revoke insert, update, delete on public.finance_entries from authenticated;
grant insert (entry_type, status, description, amount, due_at, payment_method, category, created_by)
  on public.finance_entries to authenticated;
grant update (status, settled_at) on public.finance_entries to authenticated;

-- Reservations go through one capacity-checked transaction; later status edits
-- can only change the registration state, never its contact, sale, or event.
revoke insert, update, delete on public.experience_registrations from authenticated;
grant select on public.experience_registrations to authenticated;
grant update (status) on public.experience_registrations to authenticated;

create or replace function public.provision_company_user(
  p_user_id uuid,
  p_full_name text,
  p_role text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_user_id is null or length(btrim(coalesce(p_full_name,''))) not between 1 and 160 then
    raise exception 'A valid user id and full name are required' using errcode = '22023';
  end if;
  if p_role is null or p_role not in ('owner','admin','commercial','finance','facilitator','read_only') then
    raise exception 'Invalid company role' using errcode = '22023';
  end if;
  if not exists (select 1 from auth.users where id = p_user_id) then
    raise exception 'Auth user does not exist' using errcode = '22023';
  end if;

  insert into public.profiles(id, full_name)
  values (p_user_id, btrim(p_full_name))
  on conflict (id) do update set full_name = excluded.full_name;

  insert into public.user_roles(user_id, role)
  values (p_user_id, p_role)
  on conflict (user_id, role) do nothing;
end
$$;
revoke all on function public.provision_company_user(uuid,text,text) from public, anon, authenticated;
grant execute on function public.provision_company_user(uuid,text,text) to service_role;

create or replace function app_private.sync_confirmed_sale_business_state()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  sale_status_changed boolean;
  product_category text;
  months_duration smallint;
  confirmed_at timestamptz;
begin
  if tg_op = 'INSERT' then
    sale_status_changed := true;
  else
    sale_status_changed := old.status is distinct from new.status;
  end if;
  if not sale_status_changed then return new; end if;
  select p.category, p.duration_months into product_category, months_duration
    from public.products p where p.id = new.product_id;

  if new.status = 'confirmed' then
    confirmed_at := coalesce(new.payment_confirmed_at, pg_catalog.now());
    update public.contacts set lifecycle_stage = 'customer'
      where id = new.contact_id and lifecycle_stage in ('lead','qualified');

    if product_category = 'mentoria' then
      insert into public.mentorship_enrollments as existing(
        sale_id, contact_id, product_id, status, started_at, ends_at
      ) values (
        new.id, new.contact_id, new.product_id, 'active', confirmed_at,
        case when months_duration is null then null else confirmed_at + pg_catalog.make_interval(months => months_duration) end
      )
      on conflict (sale_id) do update set
        status = 'active',
        started_at = coalesce(existing.started_at, excluded.started_at),
        ends_at = coalesce(existing.ends_at, excluded.ends_at);
    end if;
  elsif new.status = 'pending' and product_category = 'mentoria' then
    insert into public.mentorship_enrollments(sale_id, contact_id, product_id, status)
    values (new.id, new.contact_id, new.product_id, 'pending_payment')
    on conflict (sale_id) do nothing;
  end if;
  return new;
end
$$;

create trigger sales_business_state_sync
after insert or update of status on public.sales
for each row execute function app_private.sync_confirmed_sale_business_state();
revoke all on function app_private.sync_confirmed_sale_business_state() from public, anon, authenticated;

create or replace function public.register_experience_participant(
  p_experience_id uuid,
  p_contact_id uuid,
  p_sale_id uuid default null
)
returns public.experience_registrations
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_role text := coalesce(auth.jwt() ->> 'role','');
  experience_row public.experiences%rowtype;
  sale_row public.sales%rowtype;
  current_registrations bigint;
  registration_row public.experience_registrations%rowtype;
  initial_status text := 'pending_payment';
begin
  if actor_role <> 'service_role'
     and not app_private.has_any_role(array['owner','admin','commercial']) then
    raise exception 'Registration requires commercial authorization' using errcode = '42501';
  end if;
  if p_experience_id is null or p_contact_id is null then
    raise exception 'Experience and contact are required' using errcode = '22023';
  end if;
  select * into experience_row from public.experiences where id = p_experience_id for update;
  if not found or experience_row.status <> 'planned' then
    raise exception 'Only planned experiences accept registrations' using errcode = '22023';
  end if;
  if p_sale_id is not null then
    select * into sale_row from public.sales where id = p_sale_id for update;
    if not found or sale_row.contact_id <> p_contact_id or sale_row.status not in ('pending','confirmed')
       or not exists (select 1 from public.products p where p.id = sale_row.product_id and p.category = 'vivencia') then
      raise exception 'Sale must belong to the participant and remain payable' using errcode = '22023';
    end if;
    if sale_row.status = 'confirmed' then initial_status := 'confirmed'; end if;
  end if;
  select count(*) into current_registrations from public.experience_registrations
    where experience_id = p_experience_id and status <> 'cancelled';
  if experience_row.capacity is not null and current_registrations >= experience_row.capacity then
    raise exception 'Experience capacity has been reached' using errcode = '22023';
  end if;
  insert into public.experience_registrations(experience_id,contact_id,sale_id,status)
  values (p_experience_id,p_contact_id,p_sale_id,initial_status)
  returning * into registration_row;
  return registration_row;
end
$$;
revoke all on function public.register_experience_participant(uuid,uuid,uuid) from public, anon, authenticated;
grant execute on function public.register_experience_participant(uuid,uuid,uuid) to authenticated, service_role;

create or replace function public.get_dashboard_summary()
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  metrics jsonb := '{}'::jsonb;
  item_count bigint;
  incoming_confirmed numeric(14,2);
  outgoing_confirmed numeric(14,2);
  incoming_pending numeric(14,2);
  outgoing_pending numeric(14,2);
begin
  if app_private.has_any_role(array['owner','admin','commercial','finance']) then
    select count(*) into item_count from public.contacts;
    metrics := metrics || jsonb_build_object('contacts', item_count);
  end if;
  if app_private.has_any_role(array['owner','admin','commercial']) then
    select count(*) into item_count from public.opportunities;
    metrics := metrics || jsonb_build_object('opportunities', item_count);
    select count(*) into item_count from public.opportunities
      where next_follow_up_at <= pg_catalog.now() and stage not in ('won','lost');
    metrics := metrics || jsonb_build_object('followups_due', item_count);
  end if;
  if app_private.has_any_role(array['owner','admin','commercial','finance']) then
    select count(*) into item_count from public.sales where status = 'pending';
    metrics := metrics || jsonb_build_object('pending_sales', item_count);
    select count(*) into item_count from public.sales;
    metrics := metrics || jsonb_build_object('sales', item_count);
  end if;
  if app_private.has_any_role(array['owner','admin','finance']) then
    select
      coalesce(sum(amount) filter (where entry_type = 'income' and status = 'confirmed'),0),
      coalesce(sum(amount) filter (where entry_type = 'expense' and status = 'confirmed'),0),
      coalesce(sum(amount) filter (where entry_type = 'income' and status = 'pending'),0),
      coalesce(sum(amount) filter (where entry_type = 'expense' and status = 'pending'),0)
      into incoming_confirmed, outgoing_confirmed, incoming_pending, outgoing_pending
      from public.finance_entries;
    metrics := metrics || jsonb_build_object('finance', jsonb_build_object(
      'income_confirmed', incoming_confirmed,
      'expenses_confirmed', outgoing_confirmed,
      'balance_confirmed', incoming_confirmed - outgoing_confirmed,
      'income_pending', incoming_pending,
      'expenses_pending', outgoing_pending
    ));
    select count(*) into item_count from public.finance_entries;
    metrics := metrics || jsonb_build_object('finance_entries', item_count);
  end if;
  if app_private.has_any_role(array['owner','admin','commercial','facilitator']) then
    select count(*) into item_count from public.appointments where status = 'scheduled';
    metrics := metrics || jsonb_build_object('appointments', item_count);
    select count(*) into item_count from public.mentorship_enrollments where status = 'active';
    metrics := metrics || jsonb_build_object('active_mentorships', item_count);
    select count(*) into item_count from public.experience_registrations where status = 'confirmed';
    metrics := metrics || jsonb_build_object('confirmed_registrations', item_count);
  end if;
  if app_private.has_any_role(array['owner','admin','commercial','facilitator','read_only']) then
    select count(*) into item_count from public.experiences where status in ('planned','draft');
    metrics := metrics || jsonb_build_object('experiences', item_count);
  end if;
  if app_private.has_any_role(array['owner','admin','commercial']) then
    select count(*) into item_count from public.conversation_events;
    metrics := metrics || jsonb_build_object('conversations', item_count);
  end if;
  return metrics;
end
$$;
revoke all on function public.get_dashboard_summary() from public, anon;
grant execute on function public.get_dashboard_summary() to authenticated;

commit;
