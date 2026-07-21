-- AORA REVIEWED SQL PROPOSAL — DO NOT APPLY TO THE CURRENT LIVE/STAGING PROJECT.
--
-- Purpose:
--   Establish the organization owner -> store -> manager -> employee account flow.
--
-- Required execution process:
--   1. Create an isolated Supabase branch/project after cost approval.
--   2. Generate a real migration with `supabase migration new owner_store_membership_foundation`.
--   3. Copy/review this proposal in that generated migration.
--   4. Run migration, RLS, invitation, cross-tenant and rollback tests.
--   5. Run Supabase security/performance advisors.
--   6. Promote only with an approved release plan.
--
-- This file is intentionally stored under `proposals/`, not `migrations/`, so it
-- cannot be mistaken for an already tested or deployed migration.

begin;

-- ---------------------------------------------------------------------------
-- 1. Store metadata required by the international web application
-- ---------------------------------------------------------------------------

alter table public.locations
  add column if not exists slug text,
  add column if not exists address_line text,
  add column if not exists postal_code text,
  add column if not exists country_code text not null default 'DE',
  add column if not exists timezone text not null default 'Europe/Berlin',
  add column if not exists locale text not null default 'de',
  add column if not exists status text not null default 'active';

alter table public.locations
  drop constraint if exists locations_slug_format,
  add constraint locations_slug_format
    check (slug is null or slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  drop constraint if exists locations_country_code_format,
  add constraint locations_country_code_format
    check (country_code ~ '^[A-Z]{2}$'),
  drop constraint if exists locations_locale_allowed,
  add constraint locations_locale_allowed
    check (locale in ('de', 'en', 'fa', 'tr')),
  drop constraint if exists locations_status_allowed,
  add constraint locations_status_allowed
    check (status in ('active', 'archived'));

create unique index if not exists locations_org_slug_unique
  on public.locations (organization_id, slug)
  where slug is not null;

create index if not exists locations_org_status_idx
  on public.locations (organization_id, status, name);

-- Retain the invited/verified email on the membership for scoped administration.
alter table public.organization_memberships
  add column if not exists member_email text;

create index if not exists organization_memberships_org_role_location_idx
  on public.organization_memberships (organization_id, role, location_id, status);

create unique index if not exists employees_org_location_email_unique
  on public.employees (organization_id, location_id, lower(email))
  where email is not null;

-- ---------------------------------------------------------------------------
-- 2. Invitation lifecycle
-- ---------------------------------------------------------------------------

create table if not exists public.member_invitations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null
    references public.organizations(id) on delete cascade,
  location_id text not null,
  employee_id text,
  email text not null,
  display_name text not null,
  role public.aora_member_role not null,
  token_hash text not null,
  status text not null default 'pending',
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  accepted_at timestamptz,
  accepted_by uuid references auth.users(id),
  revoked_at timestamptz,
  revoke_reason text,

  constraint member_invitations_role_allowed
    check (role in ('manager'::public.aora_member_role, 'employee'::public.aora_member_role)),
  constraint member_invitations_status_allowed
    check (status in ('pending', 'accepted', 'revoked', 'expired')),
  constraint member_invitations_email_normalized
    check (email = lower(trim(email))),
  constraint member_invitations_token_hash_format
    check (token_hash ~ '^[0-9a-f]{64}$'),
  constraint member_invitations_expiry_after_creation
    check (expires_at > created_at),
  constraint member_invitations_location_fk
    foreign key (organization_id, location_id)
    references public.locations (organization_id, id)
    on delete cascade,
  constraint member_invitations_employee_fk
    foreign key (organization_id, employee_id)
    references public.employees (organization_id, id)
    on delete cascade
);

create unique index if not exists member_invitations_token_hash_unique
  on public.member_invitations (token_hash);

create unique index if not exists member_invitations_pending_scope_unique
  on public.member_invitations (
    organization_id,
    location_id,
    lower(email),
    role
  )
  where status = 'pending';

create index if not exists member_invitations_org_location_status_idx
  on public.member_invitations (
    organization_id,
    location_id,
    status,
    created_at desc
  );

-- ---------------------------------------------------------------------------
-- 3. Authorization helpers in the non-exposed private schema
-- ---------------------------------------------------------------------------

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create or replace function private.is_org_owner(p_organization_id uuid)
returns boolean
language sql
stable
security invoker
set search_path = pg_catalog, public
as $$
  select exists (
    select 1
    from public.organization_memberships membership
    where membership.organization_id = p_organization_id
      and membership.user_id = (select auth.uid())
      and membership.status = 'active'::public.aora_member_status
      and membership.role in (
        'owner'::public.aora_member_role,
        'admin'::public.aora_member_role
      )
  );
$$;

create or replace function private.can_manage_location(
  p_organization_id uuid,
  p_location_id text
)
returns boolean
language sql
stable
security invoker
set search_path = pg_catalog, public
as $$
  select exists (
    select 1
    from public.organization_memberships membership
    where membership.organization_id = p_organization_id
      and membership.user_id = (select auth.uid())
      and membership.status = 'active'::public.aora_member_status
      and (
        membership.role in (
          'owner'::public.aora_member_role,
          'admin'::public.aora_member_role
        )
        or (
          membership.role = 'manager'::public.aora_member_role
          and membership.location_id = p_location_id
        )
      )
  );
$$;

revoke all on function private.is_org_owner(uuid) from public, anon, authenticated;
revoke all on function private.can_manage_location(uuid, text) from public, anon, authenticated;
grant execute on function private.is_org_owner(uuid) to authenticated;
grant execute on function private.can_manage_location(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. RLS and table grants
-- ---------------------------------------------------------------------------

alter table public.member_invitations enable row level security;

-- Locations: owner/admin can create and change organization stores.
drop policy if exists "owners create locations" on public.locations;
create policy "owners create locations"
on public.locations
for insert
to authenticated
with check (private.is_org_owner(organization_id));

drop policy if exists "owners update locations" on public.locations;
create policy "owners update locations"
on public.locations
for update
to authenticated
using (private.is_org_owner(organization_id))
with check (private.is_org_owner(organization_id));

-- Employees: owner/admin and the assigned manager can read/write the store team.
drop policy if exists "location managers read employees" on public.employees;
create policy "location managers read employees"
on public.employees
for select
to authenticated
using (
  location_id is not null
  and private.can_manage_location(organization_id, location_id)
);

drop policy if exists "location managers create employees" on public.employees;
create policy "location managers create employees"
on public.employees
for insert
to authenticated
with check (
  location_id is not null
  and private.can_manage_location(organization_id, location_id)
);

drop policy if exists "location managers update employees" on public.employees;
create policy "location managers update employees"
on public.employees
for update
to authenticated
using (
  location_id is not null
  and private.can_manage_location(organization_id, location_id)
)
with check (
  location_id is not null
  and private.can_manage_location(organization_id, location_id)
);

drop policy if exists "location managers delete unaccepted employees" on public.employees;
create policy "location managers delete unaccepted employees"
on public.employees
for delete
to authenticated
using (
  active = false
  and location_id is not null
  and private.can_manage_location(organization_id, location_id)
);

-- Profiles: owners can see organization members; managers only their store team.
drop policy if exists "scoped managers read member profiles" on public.profiles;
create policy "scoped managers read member profiles"
on public.profiles
for select
to authenticated
using (
  exists (
    select 1
    from public.organization_memberships target
    join public.organization_memberships viewer
      on viewer.organization_id = target.organization_id
    where target.user_id = profiles.user_id
      and viewer.user_id = (select auth.uid())
      and target.status = 'active'::public.aora_member_status
      and viewer.status = 'active'::public.aora_member_status
      and (
        viewer.role in (
          'owner'::public.aora_member_role,
          'admin'::public.aora_member_role
        )
        or (
          viewer.role = 'manager'::public.aora_member_role
          and viewer.location_id = target.location_id
        )
      )
  )
);

-- Invitations: owners see all organization invitations. Managers see employee
-- invitations for their assigned store. Writes are server/admin-only.
drop policy if exists "owners read organization invitations" on public.member_invitations;
create policy "owners read organization invitations"
on public.member_invitations
for select
to authenticated
using (private.is_org_owner(organization_id));

drop policy if exists "managers read store employee invitations" on public.member_invitations;
create policy "managers read store employee invitations"
on public.member_invitations
for select
to authenticated
using (
  role = 'employee'::public.aora_member_role
  and private.can_manage_location(organization_id, location_id)
);

revoke all on public.member_invitations from anon, authenticated;
grant select on public.member_invitations to authenticated;

grant select, insert, update on public.locations to authenticated;
grant select, insert, update, delete on public.employees to authenticated;
grant select on public.organization_memberships to authenticated;
grant select on public.profiles to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Atomic invitation acceptance
-- ---------------------------------------------------------------------------

create or replace function public.accept_member_invitation(p_token text)
returns table (
  role public.aora_member_role,
  organization_id uuid,
  location_id text
)
language plpgsql
security definer
set search_path = pg_catalog, public, extensions
as $$
declare
  v_user_id uuid := auth.uid();
  v_email text := lower(coalesce(auth.jwt() ->> 'email', ''));
  v_invitation public.member_invitations%rowtype;
begin
  if v_user_id is null then
    raise exception using
      errcode = '28000',
      message = 'Authentication is required.';
  end if;

  if v_email = '' then
    raise exception using
      errcode = '22023',
      message = 'The authenticated account has no verified email.';
  end if;

  if p_token is null or length(p_token) < 32 then
    raise exception using
      errcode = '22023',
      message = 'Invitation token is invalid.';
  end if;

  select invitation.*
    into v_invitation
  from public.member_invitations invitation
  where invitation.token_hash = encode(
      extensions.digest(convert_to(p_token, 'UTF8'), 'sha256'),
      'hex'
    )
    and invitation.status = 'pending'
  for update;

  if not found then
    raise exception using
      errcode = 'P0002',
      message = 'Invitation is invalid, expired or already used.';
  end if;

  if v_invitation.expires_at <= now() then
    raise exception using
      errcode = '22023',
      message = 'Invitation has expired.';
  end if;

  if lower(v_invitation.email) <> v_email then
    raise exception using
      errcode = '42501',
      message = 'Sign in with the email address that received this invitation.';
  end if;

  insert into public.profiles (
    user_id,
    display_name,
    locale,
    timezone,
    created_at,
    updated_at
  )
  values (
    v_user_id,
    v_invitation.display_name,
    coalesce(auth.jwt() -> 'user_metadata' ->> 'locale', 'de'),
    coalesce(
      (
        select store.timezone
        from public.locations store
        where store.organization_id = v_invitation.organization_id
          and store.id = v_invitation.location_id
      ),
      'Europe/Berlin'
    ),
    now(),
    now()
  )
  on conflict (user_id) do update
    set display_name = coalesce(
          nullif(public.profiles.display_name, ''),
          excluded.display_name
        ),
        updated_at = now();

  insert into public.organization_memberships (
    organization_id,
    user_id,
    role,
    employee_id,
    location_id,
    status,
    invited_by,
    member_email,
    created_at,
    updated_at
  )
  values (
    v_invitation.organization_id,
    v_user_id,
    v_invitation.role,
    v_invitation.employee_id,
    v_invitation.location_id,
    'active'::public.aora_member_status,
    v_invitation.created_by,
    v_invitation.email,
    now(),
    now()
  )
  on conflict (organization_id, user_id) do update
    set role = excluded.role,
        employee_id = excluded.employee_id,
        location_id = excluded.location_id,
        status = 'active'::public.aora_member_status,
        invited_by = excluded.invited_by,
        member_email = excluded.member_email,
        updated_at = now();

  if v_invitation.role = 'employee'::public.aora_member_role
     and v_invitation.employee_id is not null then
    update public.employees employee
      set active = true,
          email = v_invitation.email,
          name = coalesce(nullif(employee.name, ''), v_invitation.display_name),
          payload = coalesce(employee.payload, '{}'::jsonb)
            || jsonb_build_object(
              'onboardingStatus', 'active',
              'activatedAt', now(),
              'authUserId', v_user_id
            )
    where employee.organization_id = v_invitation.organization_id
      and employee.id = v_invitation.employee_id
      and employee.location_id = v_invitation.location_id;

    if not found then
      raise exception using
        errcode = 'P0002',
        message = 'The employee profile linked to this invitation was not found.';
    end if;
  end if;

  update public.member_invitations invitation
    set status = 'accepted',
        accepted_at = now(),
        accepted_by = v_user_id,
        token_hash = encode(
          extensions.digest(
            convert_to(p_token || ':' || gen_random_uuid()::text, 'UTF8'),
            'sha256'
          ),
          'hex'
        )
  where invitation.id = v_invitation.id;

  return query
  select
    v_invitation.role,
    v_invitation.organization_id,
    v_invitation.location_id;
end;
$$;

revoke all on function public.accept_member_invitation(text)
  from public, anon;
grant execute on function public.accept_member_invitation(text)
  to authenticated;

-- ---------------------------------------------------------------------------
-- 6. Required verification after applying on an isolated environment
-- ---------------------------------------------------------------------------
--
-- Positive tests:
--   * owner creates a location in own organization
--   * owner invites manager for own location
--   * manager reads own location and creates inactive employee profile
--   * manager invites employee for own location
--   * invited email accepts once and receives correct membership
--
-- Negative tests:
--   * owner cannot create a location in another organization
--   * manager cannot create/read employee in another location
--   * employee cannot read another employee's private row
--   * different email cannot accept the invitation
--   * reused, revoked and expired token cannot be accepted
--   * public/anon cannot execute the acceptance function
--
-- Operational checks:
--   * run Supabase security advisor
--   * run Supabase performance advisor
--   * generate TypeScript database types
--   * verify invitation email and redirect allow-list
--   * test database restore/forward-repair plan

rollback;
-- Replace `rollback` with `commit` only inside a generated migration after all
-- isolated-environment tests and review gates pass.
