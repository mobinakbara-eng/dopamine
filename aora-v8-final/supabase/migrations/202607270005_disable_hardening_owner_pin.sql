update public.demo_identities identity
set active=false
from public.organizations organization
where identity.organization_id=organization.id
  and organization.slug='aora-v8-hardening-demo'
  and identity.role='admin'
  and identity.subject_id='admin_1';
