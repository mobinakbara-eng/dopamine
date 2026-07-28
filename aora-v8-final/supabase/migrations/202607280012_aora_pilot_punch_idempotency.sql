create table if not exists public.punch_events (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  event_id uuid not null,
  employee_id text not null,
  location_id text not null,
  device_id text not null,
  transition text not null check (transition in ('in','out','pause','resume')),
  client_created_at timestamptz null,
  client_timezone text null,
  device_clock_offset integer null,
  server_received_at timestamptz not null default now(),
  processed_at timestamptz null,
  status text not null default 'processing' check (status in ('processing','pending_confirmation','processing_approval','approved','denied','failed')),
  result_clock_request_id text null,
  result_time_entry_id text null,
  request_response_status integer null,
  request_response_payload jsonb null,
  approval_response_status integer null,
  approval_response_payload jsonb null,
  attempts integer not null default 1,
  last_error text null,
  updated_at timestamptz not null default now(),
  primary key (organization_id, event_id)
);

create index if not exists punch_events_org_status_received_idx
  on public.punch_events (organization_id, status, server_received_at desc);
create unique index if not exists punch_events_org_clock_request_uidx
  on public.punch_events (organization_id, result_clock_request_id)
  where result_clock_request_id is not null;
create index if not exists punch_events_device_received_idx
  on public.punch_events (organization_id, device_id, server_received_at desc);

alter table public.punch_events enable row level security;
revoke all on public.punch_events from public, anon, authenticated;
grant all on public.punch_events to service_role;

create or replace function public.aora_begin_punch(
  p_organization_id uuid,
  p_event_id uuid,
  p_employee_id text,
  p_location_id text,
  p_device_id text,
  p_transition text,
  p_client_created_at timestamptz default null,
  p_client_timezone text default null,
  p_device_clock_offset integer default null
)
returns table(
  is_new boolean,
  status text,
  result_clock_request_id text,
  result_time_entry_id text,
  request_response_status integer,
  request_response_payload jsonb,
  approval_response_status integer,
  approval_response_payload jsonb,
  attempts integer,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  inserted public.punch_events%rowtype;
  existing public.punch_events%rowtype;
begin
  if p_transition not in ('in','out','pause','resume') then
    raise exception 'invalid punch transition';
  end if;

  insert into public.punch_events (
    organization_id,event_id,employee_id,location_id,device_id,transition,
    client_created_at,client_timezone,device_clock_offset
  ) values (
    p_organization_id,p_event_id,p_employee_id,p_location_id,p_device_id,p_transition,
    p_client_created_at,p_client_timezone,p_device_clock_offset
  )
  on conflict (organization_id,event_id) do nothing
  returning * into inserted;

  if inserted.event_id is not null then
    existing := inserted;
    is_new := true;
  else
    update public.punch_events pe
    set attempts = pe.attempts + 1,
        updated_at = now()
    where pe.organization_id = p_organization_id
      and pe.event_id = p_event_id
    returning pe.* into existing;

    if existing.employee_id <> p_employee_id
       or existing.location_id <> p_location_id
       or existing.device_id <> p_device_id
       or existing.transition <> p_transition then
      raise exception 'event_id payload mismatch';
    end if;
    is_new := false;
  end if;

  status := existing.status;
  result_clock_request_id := existing.result_clock_request_id;
  result_time_entry_id := existing.result_time_entry_id;
  request_response_status := existing.request_response_status;
  request_response_payload := existing.request_response_payload;
  approval_response_status := existing.approval_response_status;
  approval_response_payload := existing.approval_response_payload;
  attempts := existing.attempts;
  updated_at := existing.updated_at;
  return next;
end;
$$;

create or replace function public.aora_complete_punch_request(
  p_organization_id uuid,
  p_event_id uuid,
  p_clock_request_id text,
  p_http_status integer,
  p_payload jsonb
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update public.punch_events
  set status = 'pending_confirmation',
      result_clock_request_id = p_clock_request_id,
      request_response_status = p_http_status,
      request_response_payload = p_payload,
      processed_at = now(),
      updated_at = now(),
      last_error = null
  where organization_id = p_organization_id
    and event_id = p_event_id;
  if not found then raise exception 'punch receipt not found'; end if;
end;
$$;

create or replace function public.aora_fail_punch(
  p_organization_id uuid,
  p_event_id uuid,
  p_error text,
  p_retryable boolean default true
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update public.punch_events
  set status = case when p_retryable then 'processing' else 'failed' end,
      last_error = left(coalesce(p_error,'unknown error'),1000),
      updated_at = now()
  where organization_id = p_organization_id and event_id = p_event_id;
end;
$$;

create or replace function public.aora_claim_punch_approval(
  p_organization_id uuid,
  p_clock_request_id text
)
returns table(
  acquired boolean,
  event_id uuid,
  status text,
  result_time_entry_id text,
  approval_response_status integer,
  approval_response_payload jsonb,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  row_value public.punch_events%rowtype;
begin
  update public.punch_events pe
  set status = 'processing_approval', updated_at = now()
  where pe.organization_id = p_organization_id
    and pe.result_clock_request_id = p_clock_request_id
    and (
      pe.status = 'pending_confirmation'
      or (pe.status = 'processing_approval' and pe.updated_at < now() - interval '30 seconds')
    )
  returning pe.* into row_value;

  if row_value.event_id is not null then
    acquired := true;
  else
    select * into row_value
    from public.punch_events pe
    where pe.organization_id = p_organization_id
      and pe.result_clock_request_id = p_clock_request_id;
    acquired := false;
  end if;

  if row_value.event_id is null then return; end if;
  event_id := row_value.event_id;
  status := row_value.status;
  result_time_entry_id := row_value.result_time_entry_id;
  approval_response_status := row_value.approval_response_status;
  approval_response_payload := row_value.approval_response_payload;
  updated_at := row_value.updated_at;
  return next;
end;
$$;

create or replace function public.aora_complete_punch_approval(
  p_organization_id uuid,
  p_event_id uuid,
  p_time_entry_id text,
  p_http_status integer,
  p_payload jsonb,
  p_final_status text default 'approved'
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if p_final_status not in ('approved','denied') then raise exception 'invalid final status'; end if;
  update public.punch_events
  set status = p_final_status,
      result_time_entry_id = p_time_entry_id,
      approval_response_status = p_http_status,
      approval_response_payload = p_payload,
      processed_at = now(),
      updated_at = now(),
      last_error = null
  where organization_id = p_organization_id and event_id = p_event_id;
  if not found then raise exception 'punch receipt not found'; end if;
end;
$$;

create or replace function public.aora_release_punch_approval(
  p_organization_id uuid,
  p_event_id uuid,
  p_error text
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update public.punch_events
  set status = 'pending_confirmation',
      last_error = left(coalesce(p_error,'unknown error'),1000),
      updated_at = now()
  where organization_id = p_organization_id
    and event_id = p_event_id
    and status = 'processing_approval';
end;
$$;

revoke all on function public.aora_begin_punch(uuid,uuid,text,text,text,text,timestamptz,text,integer) from public, anon, authenticated;
revoke all on function public.aora_complete_punch_request(uuid,uuid,text,integer,jsonb) from public, anon, authenticated;
revoke all on function public.aora_fail_punch(uuid,uuid,text,boolean) from public, anon, authenticated;
revoke all on function public.aora_claim_punch_approval(uuid,text) from public, anon, authenticated;
revoke all on function public.aora_complete_punch_approval(uuid,uuid,text,integer,jsonb,text) from public, anon, authenticated;
revoke all on function public.aora_release_punch_approval(uuid,uuid,text) from public, anon, authenticated;

grant execute on function public.aora_begin_punch(uuid,uuid,text,text,text,text,timestamptz,text,integer) to service_role;
grant execute on function public.aora_complete_punch_request(uuid,uuid,text,integer,jsonb) to service_role;
grant execute on function public.aora_fail_punch(uuid,uuid,text,boolean) to service_role;
grant execute on function public.aora_claim_punch_approval(uuid,text) to service_role;
grant execute on function public.aora_complete_punch_approval(uuid,uuid,text,integer,jsonb,text) to service_role;
grant execute on function public.aora_release_punch_approval(uuid,uuid,text) to service_role;