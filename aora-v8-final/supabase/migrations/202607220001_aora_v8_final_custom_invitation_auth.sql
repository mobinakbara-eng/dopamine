create table if not exists public.aora_v8_final_credentials (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  subject_role text not null check (subject_role in ('admin','employee')),
  subject_id text not null,
  email text not null check (email = lower(email)),
  salt text not null,
  password_hash text not null,
  iterations integer not null default 210000 check (iterations between 100000 and 1000000),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (organization_id, subject_role, subject_id),
  unique (organization_id, email)
);

create table if not exists public.aora_v8_final_invitation_tokens (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  invitation_id text not null,
  token_hash char(64) not null,
  expires_at timestamptz not null,
  used_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (organization_id, invitation_id)
);

create index if not exists aora_v8_final_invitation_tokens_active_idx
  on public.aora_v8_final_invitation_tokens (organization_id, expires_at)
  where used_at is null and revoked_at is null;

alter table public.aora_v8_final_credentials enable row level security;
alter table public.aora_v8_final_invitation_tokens enable row level security;

revoke all on public.aora_v8_final_credentials from anon, authenticated;
revoke all on public.aora_v8_final_invitation_tokens from anon, authenticated;
grant all on public.aora_v8_final_credentials to service_role;
grant all on public.aora_v8_final_invitation_tokens to service_role;

comment on table public.aora_v8_final_credentials is
  'Isolated password credentials for the Aora V8 final copy. Service-role only.';
comment on table public.aora_v8_final_invitation_tokens is
  'Hashed, one-time invitation tokens for the Aora V8 final copy. Service-role only.';
