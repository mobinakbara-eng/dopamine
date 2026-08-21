-- AORA DATEV integration foundation
-- Additive only. This migration does not delete or rewrite existing payroll/time data.
-- Provider secrets are stored only as encrypted ciphertext and are never exposed through client RLS.

create table if not exists public.datev_connections (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  service text not null check (service in ('hr_files','hr_exchange')),
  environment text not null default 'sandbox' check (environment in ('sandbox','production')),
  payroll_system text not null check (payroll_system in ('datev_lodas','datev_lohn_gehalt')),
  datev_client_id text,
  berater_number text,
  mandant_number text,
  scopes text[] not null default '{}'::text[],
  issuer_account_id text,
  issuer_name text,
  status text not null default 'inactive'
    check (status in ('inactive','connecting','connected','disconnected','error')),
  refresh_token_expires_at timestamptz,
  last_access_check_at timestamptz,
  last_sync_at timestamptz,
  last_error_code text,
  last_error_message text,
  connected_at timestamptz,
  disconnected_at timestamptz,
  created_by text not null,
  updated_by text not null,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  unique (organization_id, service, environment)
);

create index if not exists datev_connections_org_status_idx
  on public.datev_connections (organization_id, status, service);

create table if not exists public.datev_connection_secrets (
  connection_id uuid primary key references public.datev_connections(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  refresh_token_ciphertext text not null,
  refresh_token_iv text not null,
  key_version integer not null default 1 check (key_version > 0),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp()
);

create index if not exists datev_connection_secrets_org_idx
  on public.datev_connection_secrets (organization_id);

create table if not exists public.datev_oauth_transactions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  connection_id uuid not null references public.datev_connections(id) on delete cascade,
  actor_id text not null,
  state_hash text not null unique check (state_hash ~ '^[a-f0-9]{64}$'),
  nonce_hash text not null check (nonce_hash ~ '^[a-f0-9]{64}$'),
  code_verifier_ciphertext text not null,
  code_verifier_iv text not null,
  redirect_uri text not null,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default clock_timestamp()
);

create index if not exists datev_oauth_transactions_lookup_idx
  on public.datev_oauth_transactions (connection_id, expires_at desc);

create table if not exists public.datev_sync_jobs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  connection_id uuid not null references public.datev_connections(id) on delete cascade,
  service text not null check (service in ('hr_files','hr_exchange')),
  use_case text not null,
  direction text not null check (direction in ('outbound','inbound','bidirectional')),
  status text not null default 'queued'
    check (status in ('queued','submitted','processing','succeeded','failed','dead_letter','cancelled')),
  remote_job_id text,
  operation_key text not null,
  correlation_id uuid not null default gen_random_uuid(),
  payroll_period_id uuid,
  payload_hash text check (payload_hash is null or payload_hash ~ '^[a-f0-9]{64}$'),
  result_checksum text check (result_checksum is null or result_checksum ~ '^[a-f0-9]{64}$'),
  attempt integer not null default 0 check (attempt >= 0),
  next_poll_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  last_error_code text,
  last_error_message text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  unique (connection_id, operation_key)
);

create index if not exists datev_sync_jobs_org_status_idx
  on public.datev_sync_jobs (organization_id, status, created_at desc);
create index if not exists datev_sync_jobs_remote_idx
  on public.datev_sync_jobs (connection_id, remote_job_id)
  where remote_job_id is not null;

create table if not exists public.datev_mappings (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  connection_id uuid not null references public.datev_connections(id) on delete cascade,
  mapping_type text not null,
  internal_id text not null,
  external_id text not null,
  source text not null default 'datev',
  version integer not null default 1 check (version > 0),
  last_seen_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  unique (connection_id, mapping_type, internal_id),
  unique (connection_id, mapping_type, external_id)
);

create index if not exists datev_mappings_org_type_idx
  on public.datev_mappings (organization_id, mapping_type);

create table if not exists public.datev_outbox (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  connection_id uuid not null references public.datev_connections(id) on delete cascade,
  operation_key text not null,
  use_case text not null,
  entity_type text not null,
  entity_id text not null,
  payload jsonb not null,
  payload_hash text not null check (payload_hash ~ '^[a-f0-9]{64}$'),
  status text not null default 'pending'
    check (status in ('pending','processing','sent','failed','dead_letter','cancelled')),
  attempt integer not null default 0 check (attempt >= 0),
  next_attempt_at timestamptz,
  last_error_code text,
  last_error_message text,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  unique (connection_id, operation_key)
);

create index if not exists datev_outbox_pending_idx
  on public.datev_outbox (status, next_attempt_at, created_at)
  where status in ('pending','failed');

create table if not exists public.datev_http_logs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  connection_id uuid references public.datev_connections(id) on delete set null,
  correlation_id uuid,
  occurred_at timestamptz not null default clock_timestamp(),
  method text not null,
  host text not null,
  path text not null,
  query_keys text[] not null default '{}'::text[],
  http_status integer,
  status_message text,
  datev_transaction_id text,
  datev_request_id text,
  duration_ms integer check (duration_ms is null or duration_ms >= 0),
  metadata jsonb not null default '{}'::jsonb
);

create index if not exists datev_http_logs_trace_idx
  on public.datev_http_logs (organization_id, occurred_at desc, correlation_id);
create index if not exists datev_http_logs_retention_idx
  on public.datev_http_logs (occurred_at);

create table if not exists public.datev_ascii_exports (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  payroll_period_id uuid not null,
  target_system text not null check (target_system in ('datev_lodas','datev_lohn_gehalt')),
  export_kind text not null default 'movement' check (export_kind in ('movement','master','combined')),
  schema_version text not null,
  file_name text not null,
  storage_path text not null unique,
  checksum_sha256 text not null check (checksum_sha256 ~ '^[a-f0-9]{64}$'),
  row_count integer not null default 0 check (row_count >= 0),
  status text not null default 'ready' check (status in ('processing','ready','failed')),
  validation_status text not null default 'not_test_imported'
    check (validation_status in ('not_test_imported','test_import_passed','test_import_failed','datev_review_passed')),
  created_by text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default clock_timestamp()
);

create index if not exists datev_ascii_exports_period_idx
  on public.datev_ascii_exports (organization_id, payroll_period_id, created_at desc);

-- A private bucket dedicated to provider artifacts. No public URL is allowed.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'datev-exports',
  'datev-exports',
  false,
  5242880,
  array['text/plain','text/csv','application/octet-stream']
)
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

-- DATEV-specific wage-type metadata is additive to the existing payroll mapping table.
do $$
begin
  if to_regclass('public.wage_type_mappings') is not null then
    alter table public.wage_type_mappings
      add column if not exists provider_config jsonb not null default '{}'::jsonb;
  end if;
end $$;

-- Deny direct browser access. Edge/service-role code is the only persistence boundary.
alter table public.datev_connections enable row level security;
alter table public.datev_connection_secrets enable row level security;
alter table public.datev_oauth_transactions enable row level security;
alter table public.datev_sync_jobs enable row level security;
alter table public.datev_mappings enable row level security;
alter table public.datev_outbox enable row level security;
alter table public.datev_http_logs enable row level security;
alter table public.datev_ascii_exports enable row level security;

do $$
declare
  t text;
begin
  foreach t in array array[
    'datev_connections','datev_connection_secrets','datev_oauth_transactions',
    'datev_sync_jobs','datev_mappings','datev_outbox','datev_http_logs','datev_ascii_exports'
  ] loop
    if not exists (
      select 1 from pg_policies
      where schemaname='public' and tablename=t and policyname='edge_only_deny_direct'
    ) then
      execute format(
        'create policy edge_only_deny_direct on public.%I for all to anon, authenticated using (false) with check (false)',
        t
      );
    end if;
  end loop;
end $$;

-- Technical DATEV HTTP logs must be retained for at least 14 days. This helper intentionally
-- deletes only records older than 30 days and is not scheduled automatically by this migration.
create or replace function public.aora_prune_datev_http_logs_30d()
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count bigint;
begin
  delete from public.datev_http_logs
   where occurred_at < clock_timestamp() - interval '30 days';
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.aora_prune_datev_http_logs_30d() from public, anon, authenticated;
grant execute on function public.aora_prune_datev_http_logs_30d() to service_role;
