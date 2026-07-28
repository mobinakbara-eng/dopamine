create table if not exists public.manager_location_access (
  organization_id uuid not null,
  manager_id text not null,
  membership_id uuid null,
  location_id text not null,
  created_at timestamptz not null default now(),
  created_by text null,
  primary key (organization_id, manager_id, location_id),
  constraint manager_location_access_manager_fk
    foreign key (organization_id, manager_id)
    references public.admins (organization_id, id)
    on delete cascade,
  constraint manager_location_access_location_fk
    foreign key (organization_id, location_id)
    references public.locations (organization_id, id)
    on delete cascade,
  constraint manager_location_access_membership_fk
    foreign key (membership_id)
    references public.organization_memberships (id)
    on delete set null
);

create unique index if not exists manager_location_access_membership_location_uidx
  on public.manager_location_access (membership_id, location_id)
  where membership_id is not null;
create index if not exists manager_location_access_org_location_idx
  on public.manager_location_access (organization_id, location_id, manager_id);

alter table public.manager_location_access enable row level security;

alter table public.organization_memberships
  add column if not exists admin_id text null;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'organization_memberships_admin_fk'
  ) then
    alter table public.organization_memberships
      add constraint organization_memberships_admin_fk
      foreign key (organization_id, admin_id)
      references public.admins (organization_id, id)
      on delete set null;
  end if;
end $$;

create index if not exists memberships_admin_lookup_idx
  on public.organization_memberships (organization_id, admin_id, status)
  where admin_id is not null;

insert into public.manager_location_access (
  organization_id, manager_id, location_id, created_by
)
select
  ws.organization_id,
  admin_item ->> 'id' as manager_id,
  location_value as location_id,
  'snapshot-backfill'
from public.workspace_snapshots ws
cross join lateral jsonb_array_elements(coalesce(ws.state -> 'admins', '[]'::jsonb)) admin_item
cross join lateral jsonb_array_elements_text(
  case
    when jsonb_typeof(admin_item -> 'locationIds') = 'array' then admin_item -> 'locationIds'
    when nullif(admin_item ->> 'locationId', '') is not null then jsonb_build_array(admin_item ->> 'locationId')
    else '[]'::jsonb
  end
) location_value
join public.admins a
  on a.organization_id = ws.organization_id
 and a.id = admin_item ->> 'id'
join public.locations l
  on l.organization_id = ws.organization_id
 and l.id = location_value
where admin_item ->> 'scope' = 'manager'
  and coalesce(admin_item ->> 'status', 'active') <> 'revoked'
on conflict (organization_id, manager_id, location_id) do nothing;

create or replace function private.current_org_role(p_organization_id uuid)
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select m.role::text
  from public.organization_memberships m
  where m.organization_id = p_organization_id
    and m.user_id = (select auth.uid())
    and m.status = 'active'
  limit 1;
$$;

create or replace function private.current_admin_id(p_organization_id uuid)
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select m.admin_id
  from public.organization_memberships m
  where m.organization_id = p_organization_id
    and m.user_id = (select auth.uid())
    and m.status = 'active'
  limit 1;
$$;

create or replace function private.is_org_admin(p_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.organization_memberships m
    where m.organization_id = p_organization_id
      and m.user_id = (select auth.uid())
      and m.status = 'active'
      and m.role::text in ('owner', 'admin')
  );
$$;

create or replace function private.is_org_manager(p_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.organization_memberships m
    where m.organization_id = p_organization_id
      and m.user_id = (select auth.uid())
      and m.status = 'active'
      and m.role::text = 'manager'
  );
$$;

create or replace function private.manager_can_access_location(
  p_organization_id uuid,
  p_location_id text
)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.organization_memberships m
    join public.manager_location_access mla
      on mla.organization_id = m.organization_id
     and mla.membership_id = m.id
     and mla.location_id = p_location_id
    where m.organization_id = p_organization_id
      and m.user_id = (select auth.uid())
      and m.status = 'active'
      and m.role::text = 'manager'
  );
$$;

create or replace function private.can_access_location(
  p_organization_id uuid,
  p_location_id text
)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    private.is_org_admin(p_organization_id)
    or private.manager_can_access_location(p_organization_id, p_location_id)
    or exists (
      select 1
      from public.organization_memberships m
      where m.organization_id = p_organization_id
        and m.user_id = (select auth.uid())
        and m.status = 'active'
        and m.role::text = 'employee'
        and m.location_id = p_location_id
    );
$$;

create or replace function private.can_access_employee(
  p_organization_id uuid,
  p_employee_id text,
  p_location_id text
)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    private.is_org_admin(p_organization_id)
    or (
      private.is_org_manager(p_organization_id)
      and private.manager_can_access_location(p_organization_id, p_location_id)
    )
    or p_employee_id = private.current_employee_id(p_organization_id);
$$;

revoke all on function private.current_org_role(uuid) from public, anon;
revoke all on function private.current_admin_id(uuid) from public, anon;
revoke all on function private.is_org_admin(uuid) from public, anon;
revoke all on function private.is_org_manager(uuid) from public, anon;
revoke all on function private.manager_can_access_location(uuid, text) from public, anon;
revoke all on function private.can_access_location(uuid, text) from public, anon;
revoke all on function private.can_access_employee(uuid, text, text) from public, anon;

grant execute on function private.current_org_role(uuid) to authenticated, service_role;
grant execute on function private.current_admin_id(uuid) to authenticated, service_role;
grant execute on function private.is_org_admin(uuid) to authenticated, service_role;
grant execute on function private.is_org_manager(uuid) to authenticated, service_role;
grant execute on function private.manager_can_access_location(uuid, text) to authenticated, service_role;
grant execute on function private.can_access_location(uuid, text) to authenticated, service_role;
grant execute on function private.can_access_employee(uuid, text, text) to authenticated, service_role;

drop policy if exists "members read locations" on public.locations;
create policy "members read scoped locations"
on public.locations for select
to authenticated
using (private.can_access_location(organization_id, id));

drop policy if exists "admins read admins" on public.admins;
create policy "owners read admins managers read self"
on public.admins for select
to authenticated
using (
  private.is_org_admin(organization_id)
  or id = private.current_admin_id(organization_id)
);

drop policy if exists "members read own or managed employees" on public.employees;
create policy "members read scoped employees"
on public.employees for select
to authenticated
using (private.can_access_employee(organization_id, id, location_id));

drop policy if exists "members read own or managed time entries" on public.time_entries;
create policy "members read scoped time entries"
on public.time_entries for select
to authenticated
using (private.can_access_employee(organization_id, employee_id, location_id));

drop policy if exists "members read own or managed leave" on public.leave_requests;
create policy "members read scoped leave"
on public.leave_requests for select
to authenticated
using (
  private.is_org_admin(organization_id)
  or employee_id = private.current_employee_id(organization_id)
  or exists (
    select 1
    from public.employees e
    where e.organization_id = leave_requests.organization_id
      and e.id = leave_requests.employee_id
      and private.manager_can_access_location(e.organization_id, e.location_id)
  )
);

drop policy if exists "members read manager location scope" on public.manager_location_access;
create policy "members read manager location scope"
on public.manager_location_access for select
to authenticated
using (
  private.is_org_admin(organization_id)
  or exists (
    select 1
    from public.organization_memberships m
    where m.id = manager_location_access.membership_id
      and m.user_id = (select auth.uid())
      and m.status = 'active'
  )
);

revoke all on public.manager_location_access from anon;
grant select on public.manager_location_access to authenticated;
grant all on public.manager_location_access to service_role;