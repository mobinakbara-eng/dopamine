create unique index if not exists time_entries_one_open_per_employee
on public.time_entries (organization_id,employee_id)
where status in ('live','paused');
