do $$
begin
  if to_regclass('public.employee_timesheet_signature_policies') is not null then
    alter table public.employee_timesheet_signature_policies enable row level security;
    drop policy if exists employee_timesheet_signature_policies_deny_direct_client on public.employee_timesheet_signature_policies;
    create policy employee_timesheet_signature_policies_deny_direct_client
      on public.employee_timesheet_signature_policies
      for all to anon, authenticated
      using (false)
      with check (false);
  end if;
end $$;
