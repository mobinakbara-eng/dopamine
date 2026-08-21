-- DATEV OAuth secret lifecycle hardening.
-- Additive follow-up to the DATEV integration foundation.

alter table public.datev_connections
  add column if not exists token_mode text not null default 'short',
  add column if not exists token_generation bigint not null default 0;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname='datev_connections_token_mode_check'
      and conrelid='public.datev_connections'::regclass
  ) then
    alter table public.datev_connections
      add constraint datev_connections_token_mode_check
      check (token_mode in ('short','long'));
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname='datev_connections_token_generation_check'
      and conrelid='public.datev_connections'::regclass
  ) then
    alter table public.datev_connections
      add constraint datev_connections_token_generation_check
      check (token_generation >= 0);
  end if;
end $$;

alter table public.datev_oauth_transactions
  add column if not exists nonce_ciphertext text,
  add column if not exists nonce_iv text;

-- Atomic compare-and-swap for DATEV single-use refresh-token rotation.
create or replace function public.aora_rotate_datev_refresh_token_atomic(
  p_connection_id uuid,
  p_expected_generation bigint,
  p_refresh_token_ciphertext text,
  p_refresh_token_iv text,
  p_refresh_token_expires_at timestamptz
)
returns bigint
language plpgsql
security definer
set search_path=''
as $$
declare
  v_org uuid;
  v_generation bigint;
begin
  select organization_id, token_generation
    into v_org, v_generation
    from public.datev_connections
   where id=p_connection_id
   for update;

  if v_org is null then
    raise exception 'datev_connection_not_found';
  end if;
  if v_generation <> p_expected_generation then
    raise exception 'datev_refresh_token_generation_conflict';
  end if;

  insert into public.datev_connection_secrets(
    connection_id, organization_id, refresh_token_ciphertext, refresh_token_iv, key_version, updated_at
  ) values (
    p_connection_id, v_org, p_refresh_token_ciphertext, p_refresh_token_iv, 1, clock_timestamp()
  )
  on conflict (connection_id) do update
    set refresh_token_ciphertext=excluded.refresh_token_ciphertext,
        refresh_token_iv=excluded.refresh_token_iv,
        updated_at=clock_timestamp();

  update public.datev_connections
     set token_generation=token_generation+1,
         refresh_token_expires_at=p_refresh_token_expires_at,
         updated_at=clock_timestamp()
   where id=p_connection_id
   returning token_generation into v_generation;

  return v_generation;
end;
$$;

revoke all on function public.aora_rotate_datev_refresh_token_atomic(uuid,bigint,text,text,timestamptz)
  from public, anon, authenticated;
grant execute on function public.aora_rotate_datev_refresh_token_atomic(uuid,bigint,text,text,timestamptz)
  to service_role;
