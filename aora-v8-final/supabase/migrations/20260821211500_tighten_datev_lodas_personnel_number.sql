begin;

-- DATEV LODAS Personalnummer is limited to 1..99999 for this hours export.
-- Existing mappings are checked before tightening the database constraint.
do $$
begin
  if exists (
    select 1
    from public.datev_hours_employee_mappings
    where personnel_number !~ '^\d{1,5}$'
       or personnel_number::integer < 1
       or personnel_number::integer > 99999
  ) then
    raise exception 'Cannot tighten DATEV personnel-number constraint: incompatible mappings exist';
  end if;
end $$;

alter table public.datev_hours_employee_mappings
  drop constraint if exists datev_hours_employee_mappings_personnel_number_check;

alter table public.datev_hours_employee_mappings
  add constraint datev_hours_employee_mappings_personnel_number_check
  check (
    personnel_number ~ '^\d{1,5}$'
    and personnel_number::integer between 1 and 99999
  );

commit;
