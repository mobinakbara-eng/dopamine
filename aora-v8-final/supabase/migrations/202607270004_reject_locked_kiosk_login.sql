create or replace function public.demo_login(
  p_workspace_slug text,
  p_role text,
  p_subject_id text,
  p_pin text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public','extensions'
as $$
declare
  v_identity public.demo_identities%rowtype;
  v_token text;
  v_expires timestamptz;
begin
  select identity.*
  into v_identity
  from public.demo_identities identity
  join public.organizations organization on organization.id=identity.organization_id
  where organization.slug=p_workspace_slug
    and organization.status='active'
    and identity.role=p_role
    and identity.subject_id=p_subject_id
    and identity.active=true;

  if not found then
    raise exception 'Zugang wurde nicht gefunden oder ist deaktiviert.';
  end if;

  if p_role='kiosk' and exists(
    select 1
    from public.kiosk_devices device
    where device.organization_id=v_identity.organization_id
      and device.id=p_subject_id
      and (device.active=false or device.locked=true)
  ) then
    raise exception 'Dieses Kiosk-Gerät ist gesperrt oder deaktiviert.';
  end if;

  if p_role in ('admin','employee') then
    if v_identity.pin_hash is null or p_pin is null or crypt(p_pin,v_identity.pin_hash)<>v_identity.pin_hash then
      raise exception 'Das Passwort ist nicht korrekt.';
    end if;
  elsif v_identity.pin_hash is not null and (p_pin is null or crypt(p_pin,v_identity.pin_hash)<>v_identity.pin_hash) then
    raise exception 'Das Passwort ist nicht korrekt.';
  end if;

  v_token:=encode(gen_random_bytes(32),'hex');
  v_expires:=now()+interval '12 hours';
  insert into public.app_sessions(organization_id,role,subject_id,location_id,token_hash,expires_at)
  values(v_identity.organization_id,p_role,p_subject_id,v_identity.location_id,digest(v_token,'sha256'),v_expires);

  return jsonb_build_object(
    'token',v_token,
    'organizationId',v_identity.organization_id,
    'role',p_role,
    'subjectId',p_subject_id,
    'employeeId',case when p_role='employee' then p_subject_id end,
    'adminId',case when p_role='admin' then p_subject_id end,
    'deviceId',case when p_role='kiosk' then p_subject_id end,
    'locationId',v_identity.location_id,
    'expiresAt',v_expires
  );
end;
$$;

revoke all on function public.demo_login(text,text,text,text)
from public,anon,authenticated;

grant execute on function public.demo_login(text,text,text,text)
to service_role;
