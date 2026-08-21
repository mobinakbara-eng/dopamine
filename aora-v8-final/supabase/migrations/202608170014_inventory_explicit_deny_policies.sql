do $$
declare
  r record;
begin
  for r in
    select tablename
    from pg_tables
    where schemaname='public'
      and tablename like 'inventory\_%' escape '\'
  loop
    execute format('alter table public.%I enable row level security',r.tablename);
    execute format('drop policy if exists inventory_deny_direct_client on public.%I',r.tablename);
    execute format(
      'create policy inventory_deny_direct_client on public.%I for all to anon, authenticated using (false) with check (false)',
      r.tablename
    );
  end loop;
end $$;
