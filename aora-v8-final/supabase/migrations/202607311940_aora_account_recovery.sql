create table if not exists public.password_reset_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  subject_role text not null check (subject_role in ('admin','employee')),
  subject_id text not null,
  email text not null,
  status text not null default 'pending' check (status in ('pending','approved','completed','cancelled','expired')),
  requester_hash text,
  requested_at timestamptz not null default now(),
  approved_at timestamptz,
  approved_by text,
  token_hash text,
  expires_at timestamptz,
  used_at timestamptz,
  cancelled_at timestamptz,
  last_error text
);

create unique index if not exists password_reset_one_active_per_email_idx
  on public.password_reset_requests (organization_id, lower(email))
  where status in ('pending','approved');

create index if not exists password_reset_status_requested_idx
  on public.password_reset_requests (organization_id, status, requested_at desc);

create index if not exists password_reset_expiry_idx
  on public.password_reset_requests (expires_at)
  where status='approved';

alter table public.password_reset_requests enable row level security;
drop policy if exists edge_only_deny_direct on public.password_reset_requests;
create policy edge_only_deny_direct on public.password_reset_requests
  for all to anon, authenticated
  using (false)
  with check (false);
revoke all on public.password_reset_requests from anon, authenticated;
grant all on public.password_reset_requests to service_role;

create table if not exists public.support_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  email text not null,
  subject text not null,
  message text not null,
  status text not null default 'open' check (status in ('open','closed')),
  requester_hash text,
  created_at timestamptz not null default now(),
  closed_at timestamptz,
  closed_by text
);

create index if not exists support_requests_status_created_idx
  on public.support_requests (organization_id, status, created_at desc);

alter table public.support_requests enable row level security;
drop policy if exists edge_only_deny_direct on public.support_requests;
create policy edge_only_deny_direct on public.support_requests
  for all to anon, authenticated
  using (false)
  with check (false);
revoke all on public.support_requests from anon, authenticated;
grant all on public.support_requests to service_role;

create or replace function public.aora_complete_password_reset(
  p_request_id uuid,
  p_token_hash text,
  p_salt text,
  p_password_hash text,
  p_iterations integer
)
returns table(subject_role text, subject_id text, email text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  request_row public.password_reset_requests%rowtype;
  affected integer;
begin
  select * into request_row
  from public.password_reset_requests
  where id=p_request_id
  for update;

  if not found then
    raise exception 'reset_request_not_found';
  end if;
  if request_row.status<>'approved' or request_row.used_at is not null then
    raise exception 'reset_request_not_active';
  end if;
  if request_row.expires_at is null or request_row.expires_at<=now() then
    update public.password_reset_requests
      set status='expired', last_error='Token expired'
      where id=p_request_id;
    raise exception 'reset_request_expired';
  end if;
  if request_row.token_hash is null or request_row.token_hash<>p_token_hash then
    raise exception 'reset_token_invalid';
  end if;

  update public.aora_v8_final_credentials
    set salt=p_salt,
        password_hash=p_password_hash,
        iterations=p_iterations,
        active=true
    where organization_id=request_row.organization_id
      and subject_role=request_row.subject_role
      and subject_id=request_row.subject_id
      and lower(email)=lower(request_row.email);
  get diagnostics affected=row_count;
  if affected<>1 then
    raise exception 'reset_credential_not_found';
  end if;

  delete from public.app_sessions
    where organization_id=request_row.organization_id
      and role=request_row.subject_role
      and subject_id=request_row.subject_id;

  update public.password_reset_requests
    set status='completed', used_at=now(), token_hash=null, last_error=null
    where id=p_request_id;

  return query
    select request_row.subject_role, request_row.subject_id, request_row.email;
end;
$$;

revoke all on function public.aora_complete_password_reset(uuid,text,text,text,integer) from public, anon, authenticated;
grant execute on function public.aora_complete_password_reset(uuid,text,text,text,integer) to service_role;
