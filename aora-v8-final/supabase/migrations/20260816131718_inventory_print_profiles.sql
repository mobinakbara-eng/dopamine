begin;
create table if not exists public.inventory_print_profiles (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  location_id text not null,
  profile_key text not null default 'zebra_50x30_203' check (profile_key in ('zebra_50x30_203','brother_62x29_300','generic_pdf_50x30')),
  connection_mode text not null default 'system_dialog' check (connection_mode in ('system_dialog','airprint')),
  printer_model text not null default '',
  label_width_mm numeric(6,2) not null,
  label_height_mm numeric(6,2) not null,
  qr_size_mm numeric(6,2) not null,
  dpi integer not null check (dpi in (203,300)),
  media_type text not null default 'direct_thermal_gap' check (media_type in ('direct_thermal_gap','direct_thermal_continuous')),
  updated_by text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (organization_id,location_id),
  constraint inventory_print_profile_location_fk foreign key (organization_id,location_id) references public.locations(organization_id,id) on delete cascade,
  constraint inventory_print_profile_dimensions check (
    label_width_mm between 29 and 108 and label_height_mm between 20 and 100 and qr_size_mm between 18 and 35 and qr_size_mm <= least(label_width_mm,label_height_mm) - 4
  )
);
create index if not exists inventory_print_profiles_location_idx on public.inventory_print_profiles(organization_id,location_id);
alter table public.inventory_print_profiles enable row level security;
revoke all on table public.inventory_print_profiles from anon,authenticated;
grant all on table public.inventory_print_profiles to service_role;
insert into public.feature_flags(organization_id,flag_key,enabled,config)
select id,'inventory_printing',false,'{"phase":"configured_profiles","defaultProfile":"zebra_50x30_203"}'::jsonb
from public.organizations
on conflict (organization_id,location_id,flag_key) do update set config=coalesce(public.feature_flags.config,'{}'::jsonb) || excluded.config;
commit;
