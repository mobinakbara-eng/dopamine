-- Custom session tokens use subject IDs across several service-role functions.
-- Keep account identifiers globally unique so a subject can never resolve to a
-- similarly named account in another tenant.

create unique index if not exists admins_global_subject_id_uidx
  on public.admins (id);

create unique index if not exists employees_global_subject_id_uidx
  on public.employees (id);
