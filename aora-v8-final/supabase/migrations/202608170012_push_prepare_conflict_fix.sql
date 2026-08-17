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
    on conflict do nothing;

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

revoke all on function public.aora_push_prepare_deliveries(integer) from public, anon, authenticated;
grant execute on function public.aora_push_prepare_deliveries(integer) to service_role;
