create table if not exists public.aora_hardening_invite_links (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  invitation_id text not null,
  code_hash text not null unique,
  target_url text not null,
  expires_at timestamptz not null,
  opened_at timestamptz,
  open_count integer not null default 0,
  created_at timestamptz not null default now()
);

alter table public.aora_hardening_invite_links enable row level security;
revoke all on table public.aora_hardening_invite_links from public, anon, authenticated;
grant all on table public.aora_hardening_invite_links to service_role;

create or replace function public.aora_resolve_hardening_invite_link(p_code text)
returns table(target_url text, expires_at timestamptz)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_code_hash text;
  v_link public.aora_hardening_invite_links%rowtype;
begin
  if p_code is null or p_code !~ '^[a-z0-9-]{20,100}$' then
    raise exception 'invalid_code';
  end if;

  v_code_hash := encode(digest(lower(p_code), 'sha256'), 'hex');

  select l.* into v_link
  from public.aora_hardening_invite_links as l
  where l.code_hash = v_code_hash
    and l.expires_at > clock_timestamp()
  limit 1;

  if not found then
    raise exception 'invalid_or_expired_link';
  end if;

  update public.aora_hardening_invite_links as l
  set opened_at = coalesce(l.opened_at, clock_timestamp()),
      open_count = l.open_count + 1
  where l.id = v_link.id;

  target_url := v_link.target_url;
  expires_at := v_link.expires_at;
  return next;
end;
$$;

revoke all on function public.aora_resolve_hardening_invite_link(text)
  from public, anon, authenticated;
grant execute on function public.aora_resolve_hardening_invite_link(text)
  to service_role;

create or replace function public.aora_claim_hardening_invite(
  p_invitation_id text,
  p_email text
)
returns table(target_url text, expires_at timestamptz)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_org_id uuid;
  v_invitation jsonb;
  v_link public.aora_hardening_invite_links%rowtype;
  v_email text := lower(trim(coalesce(p_email, '')));
begin
  if p_invitation_id is null
     or p_invitation_id !~ '^invite_[a-zA-Z0-9-]{10,100}$'
     or v_email !~ '^[^@[:space:]]+@[^@[:space:]]+[.][^@[:space:]]+$' then
    raise exception 'claim_denied';
  end if;

  select ws.organization_id, item
    into v_org_id, v_invitation
  from public.workspace_snapshots as ws
  join public.organizations as organization
    on organization.id = ws.organization_id
  cross join lateral jsonb_array_elements(coalesce(ws.state->'invitations', '[]'::jsonb)) as item
  where organization.slug = 'aora-v8-hardening-demo'
    and item->>'id' = p_invitation_id
  limit 1;

  if v_invitation is null
     or lower(trim(coalesce(v_invitation->>'email', ''))) <> v_email
     or coalesce(v_invitation->>'status', '') <> 'pending'
     or nullif(v_invitation->>'expiresAt', '')::timestamptz <= clock_timestamp() then
    raise exception 'claim_denied';
  end if;

  select l.* into v_link
  from public.aora_hardening_invite_links as l
  where l.organization_id = v_org_id
    and l.invitation_id = p_invitation_id
    and l.expires_at > clock_timestamp()
  order by l.created_at desc
  limit 1;

  if not found then
    raise exception 'claim_denied';
  end if;

  target_url := v_link.target_url;
  expires_at := v_link.expires_at;
  return next;
end;
$$;

revoke all on function public.aora_claim_hardening_invite(text, text)
  from public, anon, authenticated;
grant execute on function public.aora_claim_hardening_invite(text, text)
  to service_role;
