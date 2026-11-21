-- Public, consent-based intake for the Mentoria Desenrola Fácil sales page.
-- Additive only: no existing rows are deleted or rewritten.
begin;

create or replace function app_private.normalize_contact_phone(phone_input text)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  with digits as (
    select ltrim(coalesce(phone_input, '')) as raw_value,
           regexp_replace(coalesce(phone_input, ''), '[^0-9]', '', 'g') as value
  )
  select case
    when left(raw_value, 1) = '+' and length(value) between 11 and 15 then value
    when length(value) in (10, 11) then '55' || value
    when length(value) between 12 and 15 then value
    else null
  end
  from digits
$$;

-- The helper is needed by authenticated CRM writes because these expression
-- indexes are evaluated whenever contacts are inserted or updated.
revoke all on function app_private.normalize_contact_phone(text) from public, anon;
grant execute on function app_private.normalize_contact_phone(text) to authenticated, service_role;

create unique index if not exists contacts_phone_normalized_uidx
  on public.contacts (app_private.normalize_contact_phone(phone))
  where app_private.normalize_contact_phone(phone) is not null;

create unique index if not exists contacts_email_normalized_uidx
  on public.contacts (lower(btrim(email)))
  where email is not null and btrim(email) <> '';

-- Idempotency receipt has no name, phone, email, or message content.
create table if not exists app_private.public_lead_receipts (
  request_id uuid primary key,
  contact_id uuid references public.contacts(id) on delete cascade,
  submitted_at timestamptz not null default now()
);
create index if not exists public_lead_receipts_contact_time_idx
  on app_private.public_lead_receipts(contact_id, submitted_at desc)
  where contact_id is not null;
alter table app_private.public_lead_receipts enable row level security;
revoke all on app_private.public_lead_receipts from public, anon, authenticated, service_role;

create or replace function public.capture_public_mentoria_lead(
  p_request_id uuid,
  p_name text,
  p_phone text,
  p_email text,
  p_source text,
  p_contact_consent boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_role text := coalesce(auth.jwt() ->> 'role', '');
  v_name text := btrim(coalesce(p_name, ''));
  v_phone text := app_private.normalize_contact_phone(p_phone);
  v_email text := nullif(lower(btrim(coalesce(p_email, ''))), '');
  v_product_id uuid;
  v_product_code text := 'mentoria-desenrola-facil';
  v_product_price numeric(12,2);
  v_phone_contact_id uuid;
  v_email_contact_id uuid;
  v_contact_id uuid;
  v_opportunity_id uuid;
  v_receipt_rows integer;
  v_new_contact boolean := false;
  v_new_opportunity boolean := false;
begin
  if caller_role <> 'service_role' then
    raise exception 'service_role_required' using errcode = '42501';
  end if;
  if p_request_id is null then
    raise exception 'request_id_required' using errcode = '22023';
  end if;
  if v_name = '' or length(v_name) > 160 or v_name ~ '[[:cntrl:]]' then
    raise exception 'invalid_name' using errcode = '22023';
  end if;
  if v_phone is null then
    raise exception 'invalid_phone' using errcode = '22023';
  end if;
  if v_email is not null and (length(v_email) > 320 or v_email !~* '^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$') then
    raise exception 'invalid_email' using errcode = '22023';
  end if;
  if p_source not in ('website:mentoria_sales_page','instagram_bio','linktree') then
    raise exception 'invalid_source' using errcode = '22023';
  end if;
  if p_contact_consent is distinct from true then
    raise exception 'contact_consent_required' using errcode = '42501';
  end if;

  select p.id, p.price into v_product_id, v_product_price
  from public.products p
  where p.code = v_product_code and p.active = true
  for share;
  if not found then
    raise exception 'active_mentoria_offer_not_found' using errcode = '22023';
  end if;

  -- Serialize submissions for the same normalized phone and prevent duplicate
  -- contacts even when two browser requests arrive at the same time.
  perform pg_advisory_xact_lock(hashtextextended(v_phone, 0));

  insert into app_private.public_lead_receipts(request_id)
  values (p_request_id)
  on conflict (request_id) do nothing;
  get diagnostics v_receipt_rows = row_count;
  if v_receipt_rows = 0 then
    return jsonb_build_object('accepted', true, 'duplicate_request', true);
  end if;

  select c.id into v_phone_contact_id
  from public.contacts c
  where app_private.normalize_contact_phone(c.phone) = v_phone
  order by c.created_at asc
  limit 1
  for update;

  if v_email is not null then
    select c.id into v_email_contact_id
    from public.contacts c
    where lower(btrim(c.email)) = v_email
    order by c.created_at asc
    limit 1
    for update;
  end if;

  if v_phone_contact_id is not null and v_email_contact_id is not null
     and v_phone_contact_id <> v_email_contact_id then
    raise exception 'contact_deduplication_conflict' using errcode = '23505';
  end if;
  v_contact_id := coalesce(v_phone_contact_id, v_email_contact_id);

  if v_contact_id is null then
    begin
      insert into public.contacts(full_name,email,phone,source,lifecycle_stage,interest_code,marketing_consent)
      values (v_name,v_email,'+' || v_phone,p_source,'lead',v_product_code,false)
      returning id into v_contact_id;
      v_new_contact := true;
    exception when unique_violation then
      -- A different request may have inserted the same email while this one ran.
      select c.id into v_phone_contact_id from public.contacts c
      where app_private.normalize_contact_phone(c.phone) = v_phone
      order by c.created_at asc limit 1 for update;
      if v_email is not null then
        select c.id into v_email_contact_id from public.contacts c
        where lower(btrim(c.email)) = v_email
        order by c.created_at asc limit 1 for update;
      end if;
      if v_phone_contact_id is not null and v_email_contact_id is not null
         and v_phone_contact_id <> v_email_contact_id then
        raise exception 'contact_deduplication_conflict' using errcode = '23505';
      end if;
      v_contact_id := coalesce(v_phone_contact_id, v_email_contact_id);
      if v_contact_id is null then
        raise exception 'contact_deduplication_retry' using errcode = '40001';
      end if;
    end;
  end if;

  if not v_new_contact then
    update public.contacts c set
      full_name = case when btrim(c.full_name) = '' then v_name else c.full_name end,
      email = coalesce(c.email, v_email),
      source = case when c.source = 'manual' then p_source else c.source end,
      interest_code = v_product_code,
      lifecycle_stage = case when c.lifecycle_stage = 'disqualified' then 'lead' else c.lifecycle_stage end
    where c.id = v_contact_id;
  end if;

  update app_private.public_lead_receipts
  set contact_id = v_contact_id
  where request_id = p_request_id;

  -- Repeated inquiries inside one minute reuse the same contact and opportunity
  -- without producing more consent rows or moving the follow-up date.
  if exists (
    select 1 from app_private.public_lead_receipts r
    where r.contact_id = v_contact_id and r.request_id <> p_request_id
      and r.submitted_at > now() - interval '1 minute'
  ) then
    return jsonb_build_object('accepted', true, 'duplicate_contact', true, 'throttled', true);
  end if;

  select o.id into v_opportunity_id
  from public.opportunities o
  where o.contact_id = v_contact_id and o.product_id = v_product_id
    and o.stage not in ('won','lost')
  order by o.created_at desc
  limit 1
  for update;

  if v_opportunity_id is null then
    insert into public.opportunities(contact_id,product_id,stage,expected_value,next_follow_up_at)
    values (v_contact_id,v_product_id,'new',v_product_price,now() + interval '1 day')
    returning id into v_opportunity_id;
    v_new_opportunity := true;
  else
    update public.opportunities
    set next_follow_up_at = now() + interval '1 day'
    where id = v_opportunity_id;
  end if;

  insert into public.communication_consents(contact_id,channel,purpose,state,source,evidence_reference)
  values (v_contact_id,'whatsapp','service','granted',p_source,
    'mentoria_interest_form:v1:' || p_request_id::text);

  return jsonb_build_object(
    'accepted', true,
    'duplicate_request', false,
    'duplicate_contact', not v_new_contact,
    'opportunity_created', v_new_opportunity
  );
end
$$;

revoke all on function public.capture_public_mentoria_lead(uuid,text,text,text,text,boolean) from public, anon, authenticated;
grant execute on function public.capture_public_mentoria_lead(uuid,text,text,text,text,boolean) to service_role;

commit;

