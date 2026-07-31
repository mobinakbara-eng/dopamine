-- Custom session tokens use subject IDs across several service-role functions.
-- Production uses globally unique generated IDs. Legacy staging databases may
-- contain historical demo duplicates, so leave them untouched instead of
-- blocking unrelated migrations.

do $$
begin
  if not exists (select 1 from public.admins group by id having count(*)>1) then
    create unique index if not exists admins_global_subject_id_uidx
      on public.admins (id);
  end if;
end
$$;

do $$
begin
  if not exists (select 1 from public.employees group by id having count(*)>1) then
    create unique index if not exists employees_global_subject_id_uidx
      on public.employees (id);
  end if;
end
$$;
