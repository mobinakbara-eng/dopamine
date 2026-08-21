do $$
begin
  if to_regclass('public.notification_push_endpoint_deliveries') is not null then
    alter table public.notification_push_endpoint_deliveries enable row level security;
    drop policy if exists notification_push_endpoint_deny_direct_client on public.notification_push_endpoint_deliveries;
    create policy notification_push_endpoint_deny_direct_client
      on public.notification_push_endpoint_deliveries
      for all to anon, authenticated
      using (false)
      with check (false);
  end if;
end $$;
