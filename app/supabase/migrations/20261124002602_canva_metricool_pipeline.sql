-- Additive content-publishing pipeline. No existing rows or objects are changed.
begin;

create table if not exists public.content_integration_settings (
  provider text primary key check (provider in ('canva', 'metricool', 'openai')),
  status text not null default 'not_configured'
    check (status in ('not_configured', 'configured', 'connected', 'reauthorization_required')),
  public_config jsonb not null default '{}'::jsonb check (jsonb_typeof(public_config) = 'object'),
  secret_reference uuid,
  token_refresh_lock_until timestamptz,
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now()
);

create table if not exists public.canva_oauth_states (
  state_hash text primary key check (length(state_hash) = 64),
  code_verifier text not null check (length(code_verifier) between 43 and 128),
  initiated_by uuid not null references public.profiles(id) on delete cascade,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists canva_oauth_states_expiry_idx
  on public.canva_oauth_states (expires_at) where consumed_at is null;

create table if not exists public.social_content_jobs (
  id uuid primary key default gen_random_uuid(),
  created_by uuid not null references public.profiles(id) on delete restrict,
  design_id text not null check (length(design_id) between 1 and 128),
  export_job_id text,
  format text not null default 'png' check (format in ('png', 'jpg')),
  caption text not null default '' check (length(caption) <= 2200),
  scheduled_at timestamptz,
  timezone text not null default 'America/Sao_Paulo',
  storage_paths text[] not null default '{}',
  status text not null default 'export_queued'
    check (status in ('export_queued', 'exporting', 'awaiting_approval', 'approved', 'normalizing_media', 'scheduling', 'scheduled', 'failed', 'needs_reconciliation')),
  idempotency_key text not null unique check (length(idempotency_key) between 16 and 128),
  approved_by uuid references public.profiles(id) on delete restrict,
  approved_at timestamptz,
  metricool_post_id text,
  safe_error_code text check (safe_error_code is null or safe_error_code ~ '^[a-z0-9_]{1,64}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (status not in ('scheduled', 'scheduling') or scheduled_at is not null),
  check (status not in ('approved', 'normalizing_media', 'scheduling', 'scheduled') or (approved_by is not null and approved_at is not null)),
  check (cardinality(storage_paths) <= 10)
);

create index if not exists social_content_jobs_recent_idx
  on public.social_content_jobs (created_at desc);
create index if not exists social_content_jobs_review_idx
  on public.social_content_jobs (status, created_at desc)
  where status in ('awaiting_approval', 'failed', 'needs_reconciliation');

alter table public.content_integration_settings enable row level security;
alter table public.canva_oauth_states enable row level security;
alter table public.social_content_jobs enable row level security;

revoke all on table public.content_integration_settings from public, anon, authenticated;
revoke all on table public.canva_oauth_states from public, anon, authenticated;
revoke all on table public.social_content_jobs from public, anon, authenticated;
grant all on table public.content_integration_settings to service_role;
grant all on table public.canva_oauth_states to service_role;
grant all on table public.social_content_jobs to service_role;

create or replace function public.content_secret_store(
  p_provider text,
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
  v_prefix text;
begin
  if p_provider not in ('canva', 'metricool', 'openai')
    or p_secret is null or length(p_secret) < 2 or length(p_secret) > 20000 then
    raise exception using errcode = '22023', message = 'invalid_secret_payload';
  end if;
  v_prefix := 'df_content_' || p_provider || '_';
  if p_secret_id is null then
    v_secret_name := v_prefix || pg_catalog.gen_random_uuid()::text;
    select vault.create_secret(p_secret, v_secret_name, 'Encrypted credentials for Desenrola Fácil content integrations') into v_secret_id;
  else
    select s.name into v_secret_name from vault.secrets as s
      where s.id = p_secret_id and s.name like v_prefix || '%';
    if v_secret_name is null then
      raise exception using errcode = '22023', message = 'secret_reference_not_owned';
    end if;
    perform vault.update_secret(p_secret_id, p_secret, v_secret_name, 'Encrypted credentials for Desenrola Fácil content integrations');
    v_secret_id := p_secret_id;
  end if;
  return v_secret_id;
end;
$function$;

create or replace function public.content_secret_read(p_provider text, p_secret_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_secret text;
begin
  if p_provider not in ('canva', 'metricool', 'openai') or p_secret_id is null then return null; end if;
  select s.decrypted_secret into v_secret from vault.decrypted_secrets as s
    where s.id = p_secret_id and s.name like ('df_content_' || p_provider || '_%');
  return v_secret;
end;
$function$;

revoke all on function public.content_secret_store(text, text, uuid) from public, anon, authenticated;
revoke all on function public.content_secret_read(text, uuid) from public, anon, authenticated;
grant execute on function public.content_secret_store(text, text, uuid) to service_role;
grant execute on function public.content_secret_read(text, uuid) to service_role;

create or replace function public.content_claim_canva_refresh(p_now timestamptz)
returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_rows integer;
begin
  update public.content_integration_settings
    set token_refresh_lock_until = p_now + interval '60 seconds', updated_at = p_now
    where provider = 'canva'
      and (token_refresh_lock_until is null or token_refresh_lock_until < p_now);
  get diagnostics v_rows = row_count;
  return v_rows > 0;
end;
$function$;

create or replace function public.content_release_canva_refresh()
returns void
language sql
security definer
set search_path = ''
as $function$
  update public.content_integration_settings set token_refresh_lock_until = null, updated_at = now() where provider = 'canva';
$function$;

revoke all on function public.content_claim_canva_refresh(timestamptz) from public, anon, authenticated;
revoke all on function public.content_release_canva_refresh() from public, anon, authenticated;
grant execute on function public.content_claim_canva_refresh(timestamptz) to service_role;
grant execute on function public.content_release_canva_refresh() to service_role;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('df-social-assets-private', 'df-social-assets-private', false, 15728640, array['image/png', 'image/jpeg'])
on conflict (id) do nothing;

do $guard$
begin
  if exists (select 1 from storage.buckets where id = 'df-social-assets-private' and public = true) then
    raise exception using errcode = '55000', message = 'social_assets_bucket_must_remain_private';
  end if;
end;
$guard$;

commit;

