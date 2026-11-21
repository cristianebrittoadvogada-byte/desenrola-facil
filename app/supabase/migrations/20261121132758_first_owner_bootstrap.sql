begin;

-- Allow the single invited company account to claim the first owner role.
-- A transaction-scoped advisory lock prevents concurrent bootstrap claims.
create or replace function public.bootstrap_first_company_owner(
  p_user_id uuid,
  p_email text,
  p_full_name text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  verified_email text;
begin
  if p_user_id is null
     or p_email is null
     or p_full_name is null
     or length(btrim(p_full_name)) not between 1 and 160 then
    raise exception 'Invalid bootstrap profile' using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(193684996, 211121);

  select pg_catalog.lower(u.email)
    into verified_email
    from auth.users as u
   where u.id = p_user_id
     and u.email_confirmed_at is not null;

  if verified_email is null
     or verified_email <> pg_catalog.lower(pg_catalog.btrim(p_email))
     or verified_email <> 'desenrolafaciljud@gmail.com' then
    raise exception 'Bootstrap identity is not authorized' using errcode = '42501';
  end if;

  if exists (select 1 from public.user_roles where role = 'owner') then
    if exists (
      select 1 from public.user_roles
       where role = 'owner' and user_id = p_user_id
    ) then
      return;
    end if;
    raise exception 'First owner is already provisioned' using errcode = '42501';
  end if;

  perform public.provision_company_user(p_user_id, btrim(p_full_name), 'owner');
end;
$$;

revoke all on function public.bootstrap_first_company_owner(uuid,text,text)
  from public, anon, authenticated;
grant execute on function public.bootstrap_first_company_owner(uuid,text,text)
  to service_role;

commit;
