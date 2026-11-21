-- Secure secret storage for the official Instagram OAuth flow.
-- Secrets remain encrypted by Supabase Vault; only Edge Functions using service_role
-- can call the narrowly scoped read/write wrappers below.
begin;

create or replace function public.meta_instagram_secret_store(
  p_secret text,
  p_secret_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_secret_id uuid;
  v_secret_name text;
begin
  if p_secret is null or length(p_secret) < 2 or length(p_secret) > 20000 then
    raise exception using errcode = '22023', message = 'invalid_secret_payload';
  end if;

  if p_secret_id is null then
    v_secret_name := 'df_meta_instagram_' || pg_catalog.gen_random_uuid()::text;
    select vault.create_secret(
      p_secret,
      v_secret_name,
      'OAuth credentials for the Desenrola Fácil Instagram integration'
    ) into v_secret_id;
  else
    select s.name into v_secret_name
    from vault.secrets as s
    where s.id = p_secret_id
      and s.name like 'df_meta_instagram_%';
    if v_secret_name is null then
      raise exception using errcode = '22023', message = 'secret_reference_not_owned';
    end if;
    perform vault.update_secret(
      p_secret_id,
      p_secret,
      v_secret_name,
      'OAuth credentials for the Desenrola Fácil Instagram integration'
    );
    v_secret_id := p_secret_id;
  end if;

  return v_secret_id;
end;
$function$;

create or replace function public.meta_instagram_secret_read(p_secret_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_secret text;
begin
  if p_secret_id is null then
    return null;
  end if;

  select s.decrypted_secret into v_secret
  from vault.decrypted_secrets as s
  where s.id = p_secret_id
    and s.name like 'df_meta_instagram_%';

  return v_secret;
end;
$function$;

revoke all on function public.meta_instagram_secret_store(text, uuid) from public, anon, authenticated;
revoke all on function public.meta_instagram_secret_read(uuid) from public, anon, authenticated;
grant execute on function public.meta_instagram_secret_store(text, uuid) to service_role;
grant execute on function public.meta_instagram_secret_read(uuid) to service_role;

commit;
