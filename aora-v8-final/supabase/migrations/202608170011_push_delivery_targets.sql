-- AORA push delivery hardening: atomic per-device delivery targets.
-- Additive only. Existing notifications and delivery rows are preserved.

create table if not exists public.notification_push_delivery_targets (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  delivery_id uuid not null references public.notification_deliveries(id) on delete cascade,
  subscription_id uuid not null references public.push_subscriptions(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending','sending','sent','delivered','failed','expired','cancelled')),
  attempts integer not null default 0 check (attempts >= 0),
  next_attempt_at timestamptz,
  claim_token uuid,
  claimed_at timestamptz,
  last_error text,
  sent_at timestamptz,
  delivered_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, delivery_id, subscription_id)
);

create index if not exists notification_push_targets_delivery_idx
  on public.notification_push_delivery_targets (organization_id, delivery_id, status);

create index if not exists notification_push_targets_claim_idx
  on public.notification_push_delivery_targets (status, next_attempt_at, claimed_at, created_at)
  where status in ('pending','sending','failed');

alter table public.notification_push_delivery_targets enable row level security;
revoke all on table public.notification_push_delivery_targets from anon, authenticated;

drop policy if exists notification_push_delivery_targets_deny_client on public.notification_push_delivery_targets;
create policy notification_push_delivery_targets_deny_client
  on public.notification_push_delivery_targets
  for all
  to anon, authenticated
  using (false)
  with check (false);

create or replace function public.aora_push_prepare_deliveries(p_limit integer default 100)
returns table(delivery_id uuid, target_count integer)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  r record;
  v_count integer;
begin
  for r in
    select d.id, d.organization_id, d.notification_id
    from public.notification_deliveries d
    where d.channel = 'web_push'
      and d.attempts < 8
      and (
        (d.status = 'pending' and (d.next_attempt_at is null or d.next_attempt_at <= now()))
        or (d.status = 'failed' and d.next_attempt_at is not null and d.next_attempt_at <= now())
        or (d.status = 'sending' and d.updated_at <= now() - interval '2 minutes')
      )
    order by d.created_at asc
    for update skip locked
    limit greatest(1, least(coalesce(p_limit, 100), 500))
  loop
    insert into public.notification_push_delivery_targets (
      organization_id, delivery_id, subscription_id, status, created_at, updated_at
    )
    select r.organization_id, r.id, s.id, 'pending', now(), now()
    from public.notifications n
    join public.push_subscriptions s
      on s.organization_id = n.organization_id
     and s.employee_id = n.employee_id
     and s.active = true
    where n.organization_id = r.organization_id
      and n.id = r.notification_id
      and n.deleted_at is null
      and n.employee_id is not null
    on conflict (organization_id, delivery_id, subscription_id) do nothing;

    select count(*)::integer
      into v_count
    from public.notification_push_delivery_targets t
    where t.organization_id = r.organization_id
      and t.delivery_id = r.id
      and t.status <> 'cancelled';

    if v_count = 0 then
      update public.notification_deliveries
      set status = 'expired',
          attempts = attempts + 1,
          last_error = 'no_active_push_subscription',
          next_attempt_at = null,
          updated_at = now()
      where id = r.id;
    else
      update public.notification_deliveries
      set status = 'sending',
          last_error = null,
          updated_at = now()
      where id = r.id;
    end if;

    delivery_id := r.id;
    target_count := v_count;
    return next;
  end loop;
end;
$$;

create or replace function public.aora_push_claim_targets(
  p_worker_id uuid,
  p_limit integer default 100,
  p_lock_timeout_seconds integer default 120
)
returns table(
  target_id uuid,
  organization_id uuid,
  delivery_id uuid,
  subscription_id uuid,
  attempts integer,
  claim_token uuid
)
language sql
security definer
set search_path = public, extensions
as $$
  with candidates as (
    select t.id
    from public.notification_push_delivery_targets t
    where t.attempts < 8
      and (
        (t.status = 'pending' and (t.next_attempt_at is null or t.next_attempt_at <= now()))
        or (t.status = 'failed' and t.next_attempt_at is not null and t.next_attempt_at <= now())
        or (
          t.status = 'sending'
          and t.claimed_at is not null
          and t.claimed_at <= now() - make_interval(secs => greatest(30, least(coalesce(p_lock_timeout_seconds,120), 900)))
        )
      )
    order by t.created_at asc
    for update skip locked
    limit greatest(1, least(coalesce(p_limit, 100), 500))
  ), claimed as (
    update public.notification_push_delivery_targets t
    set status = 'sending',
        attempts = t.attempts + 1,
        claim_token = p_worker_id,
        claimed_at = now(),
        next_attempt_at = null,
        updated_at = now()
    where t.id in (select id from candidates)
    returning t.id, t.organization_id, t.delivery_id, t.subscription_id, t.attempts, t.claim_token
  )
  select c.id, c.organization_id, c.delivery_id, c.subscription_id, c.attempts, c.claim_token
  from claimed c;
$$;

create or replace function public.aora_push_reconcile_delivery(p_delivery_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_delivery public.notification_deliveries%rowtype;
  v_total integer := 0;
  v_success integer := 0;
  v_retryable integer := 0;
  v_sending integer := 0;
  v_expired integer := 0;
  v_terminal_failed integer := 0;
  v_max_attempts integer := 0;
  v_next timestamptz;
  v_error text;
  v_status text;
begin
  select * into v_delivery
  from public.notification_deliveries
  where id = p_delivery_id
  for update;

  if not found then
    raise exception 'delivery_not_found';
  end if;

  select
    count(*)::integer,
    count(*) filter (where status in ('sent','delivered'))::integer,
    count(*) filter (
      where status = 'pending'
         or status = 'sending'
         or (status = 'failed' and attempts < 8 and next_attempt_at is not null)
    )::integer,
    count(*) filter (where status = 'sending')::integer,
    count(*) filter (where status = 'expired')::integer,
    count(*) filter (where status = 'failed' and attempts >= 8)::integer,
    coalesce(max(attempts),0)::integer,
    min(next_attempt_at) filter (where status = 'failed' and attempts < 8 and next_attempt_at is not null),
    max(last_error) filter (where last_error is not null)
  into v_total, v_success, v_retryable, v_sending, v_expired, v_terminal_failed, v_max_attempts, v_next, v_error
  from public.notification_push_delivery_targets
  where organization_id = v_delivery.organization_id
    and delivery_id = p_delivery_id
    and status <> 'cancelled';

  if v_total = 0 then
    v_status := 'expired';
    v_error := coalesce(v_error, 'no_push_targets');
  elsif v_retryable > 0 then
    v_status := case when v_sending > 0 then 'sending' else 'failed' end;
  elsif v_success > 0 then
    v_status := 'sent';
    if v_success < v_total then
      v_error := coalesce(v_error, 'partial_push_delivery');
    else
      v_error := null;
    end if;
  elsif v_expired = v_total then
    v_status := 'expired';
  else
    v_status := 'failed';
    v_error := coalesce(v_error, 'all_push_targets_failed');
  end if;

  update public.notification_deliveries
  set status = v_status,
      attempts = greatest(attempts, v_max_attempts),
      next_attempt_at = case when v_status = 'failed' and v_retryable > 0 then v_next else null end,
      sent_at = case when v_status = 'sent' then coalesce(sent_at, now()) else sent_at end,
      last_error = v_error,
      updated_at = now()
  where id = p_delivery_id;

  return jsonb_build_object(
    'deliveryId', p_delivery_id,
    'status', v_status,
    'targets', v_total,
    'successful', v_success,
    'retryable', v_retryable,
    'expired', v_expired,
    'terminalFailed', v_terminal_failed,
    'attempts', v_max_attempts,
    'nextAttemptAt', v_next
  );
end;
$$;

revoke all on function public.aora_push_prepare_deliveries(integer) from public, anon, authenticated;
revoke all on function public.aora_push_claim_targets(uuid, integer, integer) from public, anon, authenticated;
revoke all on function public.aora_push_reconcile_delivery(uuid) from public, anon, authenticated;

grant execute on function public.aora_push_prepare_deliveries(integer) to service_role;
grant execute on function public.aora_push_claim_targets(uuid, integer, integer) to service_role;
grant execute on function public.aora_push_reconcile_delivery(uuid) to service_role;
