-- Desenrola Fácil | Registro de contratos vinculados a vendas.
-- Aditiva: preserva todos os registros e exige confirmação humana dos marcos.
begin;

create table if not exists public.contracts (
  id uuid primary key default gen_random_uuid(),
  contract_number text not null unique default (
    'DF-' || to_char(now() at time zone 'utc','YYYYMMDD') || '-' ||
    upper(substr(replace(gen_random_uuid()::text,'-',''),1,8))
  ),
  sale_id uuid not null unique references public.sales(id) on delete restrict,
  status text not null default 'draft'
    check (status in ('draft','sent','signed','cancelled')),
  contract_text text not null
    check (length(btrim(contract_text)) between 1 and 20000),
  sent_at timestamptz,
  signed_at timestamptz,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (status = 'draft' and sent_at is null and signed_at is null) or
    (status = 'sent' and sent_at is not null and signed_at is null) or
    (status = 'signed' and sent_at is not null and signed_at is not null) or
    (status = 'cancelled' and signed_at is null)
  )
);

create index if not exists contracts_status_updated_idx
  on public.contracts(status,updated_at desc);

create or replace function app_private.guard_contract_state()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if new.status <> 'draft' then
      raise exception 'Contracts must be created as drafts' using errcode = '22023';
    end if;
    new.sent_at := null;
    new.signed_at := null;
    return new;
  end if;

  if new.contract_number is distinct from old.contract_number
     or new.sale_id is distinct from old.sale_id
     or new.created_by is distinct from old.created_by
     or new.created_at is distinct from old.created_at then
    raise exception 'Contract identity and sale link are immutable' using errcode = '22023';
  end if;

  if new.contract_text is distinct from old.contract_text and old.status <> 'draft' then
    raise exception 'Only draft contract text can be edited' using errcode = '22023';
  end if;

  if new.status is distinct from old.status then
    if old.status = 'draft' and new.status = 'sent' then
      new.sent_at := coalesce(old.sent_at,now());
      new.signed_at := null;
    elsif old.status = 'sent' and new.status = 'signed' then
      new.sent_at := old.sent_at;
      new.signed_at := now();
    elsif (old.status = 'draft' and new.status = 'cancelled')
       or (old.status = 'sent' and new.status = 'cancelled') then
      new.sent_at := old.sent_at;
      new.signed_at := null;
    else
      raise exception 'Invalid contract status transition' using errcode = '22023';
    end if;
  else
    new.sent_at := old.sent_at;
    new.signed_at := old.signed_at;
  end if;
  return new;
end
$$;
revoke all on function app_private.guard_contract_state() from public, anon, authenticated;

create trigger contracts_state_guard before insert or update on public.contracts
for each row execute function app_private.guard_contract_state();
create trigger contracts_updated_at before update on public.contracts
for each row execute function app_private.set_updated_at();
create trigger audit_contracts after insert or update or delete on public.contracts
for each row execute function app_private.write_audit_log();

alter table public.contracts enable row level security;
revoke all on table public.contracts from anon, authenticated;
grant select,insert on public.contracts to authenticated;
revoke insert on public.contracts from authenticated;
grant insert (sale_id,contract_text,created_by) on public.contracts to authenticated;
grant update (contract_text,status) on public.contracts to authenticated;
grant select,insert,update,delete on public.contracts to service_role;

create policy contracts_read_authorized on public.contracts for select to authenticated
using (app_private.has_any_role(array['owner','admin','commercial','finance']));
create policy contracts_insert_commercial on public.contracts for insert to authenticated
with check (
  app_private.has_any_role(array['owner','admin','commercial']) and
  status = 'draft' and created_by = app_private.current_actor_id()
);
create policy contracts_update_commercial on public.contracts for update to authenticated
using (app_private.has_any_role(array['owner','admin','commercial']))
with check (app_private.has_any_role(array['owner','admin','commercial']));

commit;
