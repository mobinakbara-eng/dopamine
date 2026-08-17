-- Inventory is additive and isolated from workspace_snapshots. The feature is
-- created disabled so deploying this migration cannot change the current UI or
-- write path for existing organizations.
create table if not exists public.inventory_items (
  organization_id uuid not null references public.organizations(id) on delete restrict,
  id uuid not null default gen_random_uuid(),
  sku text not null,
  barcode text,
  name text not null,
  base_uom text not null check (base_uom in ('piece','kg','g','l','ml','box','pack')),
  category text,
  active boolean not null default true,
  version integer not null default 1 check (version > 0),
  created_by text not null,
  updated_by text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (organization_id,id),
  unique (organization_id,sku),
  check (length(trim(sku)) between 1 and 80),
  check (length(trim(name)) between 1 and 160)
);

create table if not exists public.inventory_suppliers (
  organization_id uuid not null references public.organizations(id) on delete restrict,
  id uuid not null default gen_random_uuid(),
  name text not null,
  contact jsonb not null default '{}'::jsonb,
  active boolean not null default true,
  version integer not null default 1 check (version > 0),
  created_by text not null,
  updated_by text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (organization_id,id),
  unique (organization_id,name)
);

create table if not exists public.inventory_item_locations (
  organization_id uuid not null,
  location_id text not null,
  item_id uuid not null,
  reorder_point numeric(20,6) not null default 0 check (reorder_point >= 0),
  par_level numeric(20,6) check (par_level is null or par_level >= 0),
  minimum_level numeric(20,6) check (minimum_level is null or minimum_level >= 0),
  maximum_level numeric(20,6) check (maximum_level is null or maximum_level >= 0),
  preferred_supplier_id uuid,
  active boolean not null default true,
  updated_at timestamptz not null default now(),
  primary key (organization_id,location_id,item_id),
  foreign key (organization_id,location_id) references public.locations(organization_id,id) on delete restrict,
  foreign key (organization_id,item_id) references public.inventory_items(organization_id,id) on delete restrict,
  foreign key (organization_id,preferred_supplier_id) references public.inventory_suppliers(organization_id,id) on delete set null (preferred_supplier_id),
  check (maximum_level is null or minimum_level is null or maximum_level >= minimum_level)
);

create table if not exists public.inventory_balances (
  organization_id uuid not null,
  location_id text not null,
  item_id uuid not null,
  on_hand numeric(20,6) not null default 0 check (on_hand >= 0),
  reserved numeric(20,6) not null default 0 check (reserved >= 0),
  in_transit_in numeric(20,6) not null default 0 check (in_transit_in >= 0),
  version bigint not null default 0 check (version >= 0),
  updated_at timestamptz not null default now(),
  primary key (organization_id,location_id,item_id),
  foreign key (organization_id,location_id,item_id)
    references public.inventory_item_locations(organization_id,location_id,item_id) on delete restrict,
  check (reserved <= on_hand)
);

create table if not exists public.inventory_movements (
  organization_id uuid not null references public.organizations(id) on delete restrict,
  id uuid not null default gen_random_uuid(),
  location_id text not null,
  item_id uuid not null,
  movement_type text not null check (movement_type in (
    'opening_balance','receipt','consumption','waste','adjustment_in','adjustment_out','transfer_out','transfer_in'
  )),
  quantity_delta numeric(20,6) not null check (quantity_delta <> 0),
  reason_code text,
  reference_type text,
  reference_id text,
  actor_id text not null,
  actor_role text not null check (actor_role in ('owner','manager','employee','system')),
  idempotency_key text not null,
  result_snapshot jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  primary key (organization_id,id),
  unique (organization_id,idempotency_key),
  foreign key (organization_id,location_id,item_id)
    references public.inventory_item_locations(organization_id,location_id,item_id) on delete restrict,
  check (length(idempotency_key) between 8 and 220)
);

create table if not exists public.inventory_purchase_orders (
  organization_id uuid not null references public.organizations(id) on delete restrict,
  id uuid not null default gen_random_uuid(),
  supplier_id uuid not null,
  location_id text not null,
  status text not null default 'draft' check (status in ('draft','submitted','partially_received','received','cancelled')),
  expected_on date,
  note text,
  version integer not null default 1 check (version > 0),
  created_by text not null,
  updated_by text not null,
  submitted_at timestamptz,
  received_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (organization_id,id),
  foreign key (organization_id,supplier_id) references public.inventory_suppliers(organization_id,id) on delete restrict,
  foreign key (organization_id,location_id) references public.locations(organization_id,id) on delete restrict
);

create table if not exists public.inventory_purchase_order_lines (
  organization_id uuid not null,
  purchase_order_id uuid not null,
  item_id uuid not null,
  ordered_quantity numeric(20,6) not null check (ordered_quantity > 0),
  received_quantity numeric(20,6) not null default 0 check (received_quantity >= 0),
  unit_cost numeric(20,6) check (unit_cost is null or unit_cost >= 0),
  primary key (organization_id,purchase_order_id,item_id),
  foreign key (organization_id,purchase_order_id) references public.inventory_purchase_orders(organization_id,id) on delete restrict,
  foreign key (organization_id,item_id) references public.inventory_items(organization_id,id) on delete restrict,
  check (received_quantity <= ordered_quantity)
);

create table if not exists public.inventory_transfers (
  organization_id uuid not null references public.organizations(id) on delete restrict,
  id uuid not null default gen_random_uuid(),
  source_location_id text not null,
  destination_location_id text not null,
  status text not null default 'draft' check (status in ('draft','dispatched','received','cancelled')),
  note text,
  version integer not null default 1 check (version > 0),
  idempotency_key text not null,
  created_by text not null,
  updated_by text not null,
  dispatched_at timestamptz,
  received_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (organization_id,id),
  unique (organization_id,idempotency_key),
  foreign key (organization_id,source_location_id) references public.locations(organization_id,id) on delete restrict,
  foreign key (organization_id,destination_location_id) references public.locations(organization_id,id) on delete restrict,
  check (source_location_id <> destination_location_id)
);

create table if not exists public.inventory_transfer_lines (
  organization_id uuid not null,
  transfer_id uuid not null,
  item_id uuid not null,
  requested_quantity numeric(20,6) not null check (requested_quantity > 0),
  dispatched_quantity numeric(20,6) not null default 0 check (dispatched_quantity >= 0),
  received_quantity numeric(20,6) not null default 0 check (received_quantity >= 0),
  primary key (organization_id,transfer_id,item_id),
  foreign key (organization_id,transfer_id) references public.inventory_transfers(organization_id,id) on delete restrict,
  foreign key (organization_id,item_id) references public.inventory_items(organization_id,id) on delete restrict,
  check (dispatched_quantity <= requested_quantity),
  check (received_quantity <= dispatched_quantity)
);

create table if not exists public.inventory_permission_grants (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  subject_type text not null check (subject_type in ('admin','employee')),
  subject_id text not null,
  location_id text not null,
  permission text not null check (permission in ('view','receipt','consume','waste','transfer_dispatch','transfer_receive','adjust','procurement')),
  granted_by text not null,
  created_at timestamptz not null default now(),
  primary key (organization_id,subject_type,subject_id,location_id,permission),
  foreign key (organization_id,location_id) references public.locations(organization_id,id) on delete cascade
);

create table if not exists public.inventory_outbox (
  organization_id uuid not null references public.organizations(id) on delete restrict,
  id uuid not null default gen_random_uuid(),
  event_type text not null,
  aggregate_type text not null,
  aggregate_id text not null,
  payload jsonb not null default '{}'::jsonb,
  attempts integer not null default 0 check (attempts >= 0),
  next_attempt_at timestamptz not null default now(),
  processed_at timestamptz,
  created_at timestamptz not null default now(),
  primary key (organization_id,id)
);

create index if not exists inventory_items_active_idx on public.inventory_items(organization_id,active,name);
create unique index if not exists inventory_items_barcode_uidx on public.inventory_items(organization_id,barcode) where barcode is not null;
create index if not exists inventory_item_locations_item_idx on public.inventory_item_locations(organization_id,item_id,location_id);
create index if not exists inventory_balances_location_idx on public.inventory_balances(organization_id,location_id,item_id);
create index if not exists inventory_movements_location_time_idx on public.inventory_movements(organization_id,location_id,occurred_at desc,id desc);
create index if not exists inventory_movements_item_time_idx on public.inventory_movements(organization_id,item_id,occurred_at desc);
create index if not exists inventory_po_location_status_idx on public.inventory_purchase_orders(organization_id,location_id,status,created_at desc);
create index if not exists inventory_po_supplier_idx on public.inventory_purchase_orders(organization_id,supplier_id,status);
create index if not exists inventory_transfers_source_idx on public.inventory_transfers(organization_id,source_location_id,status,created_at desc);
create index if not exists inventory_transfers_destination_idx on public.inventory_transfers(organization_id,destination_location_id,status,created_at desc);
create index if not exists inventory_outbox_pending_idx on public.inventory_outbox(next_attempt_at,created_at) where processed_at is null;

do $$ begin
  if to_regclass('public.app_sessions') is not null then
    execute 'create index if not exists app_sessions_organization_idx on public.app_sessions(organization_id)';
  end if;
  if to_regclass('public.work_rules') is not null then
    execute 'create index if not exists work_rules_organization_idx on public.work_rules(organization_id)';
  end if;
end $$;

create or replace function public.aora_inventory_movement_immutable()
returns trigger language plpgsql set search_path=public,pg_temp as $$
begin
  raise exception using errcode='55000',message='inventory_movement_immutable';
end $$;

drop trigger if exists inventory_movements_immutable on public.inventory_movements;
create trigger inventory_movements_immutable
before update or delete on public.inventory_movements
for each row execute function public.aora_inventory_movement_immutable();

alter table public.inventory_items enable row level security;
alter table public.inventory_suppliers enable row level security;
alter table public.inventory_item_locations enable row level security;
alter table public.inventory_balances enable row level security;
alter table public.inventory_movements enable row level security;
alter table public.inventory_purchase_orders enable row level security;
alter table public.inventory_purchase_order_lines enable row level security;
alter table public.inventory_transfers enable row level security;
alter table public.inventory_transfer_lines enable row level security;
alter table public.inventory_permission_grants enable row level security;
alter table public.inventory_outbox enable row level security;

revoke all on table public.inventory_items,public.inventory_suppliers,public.inventory_item_locations,
  public.inventory_balances,public.inventory_movements,public.inventory_purchase_orders,
  public.inventory_purchase_order_lines,public.inventory_transfers,public.inventory_transfer_lines,
  public.inventory_permission_grants,public.inventory_outbox
from public,anon,authenticated;

grant all on table public.inventory_items,public.inventory_suppliers,public.inventory_item_locations,
  public.inventory_balances,public.inventory_movements,public.inventory_purchase_orders,
  public.inventory_purchase_order_lines,public.inventory_transfers,public.inventory_transfer_lines,
  public.inventory_permission_grants,public.inventory_outbox
to service_role;

revoke all on function public.aora_inventory_movement_immutable() from public,anon,authenticated;

insert into public.feature_flags(organization_id,flag_key,enabled,config)
select id,'inventory_v1',false,jsonb_build_object('rollout','off','schemaVersion',1)
from public.organizations
on conflict (organization_id,location_id,flag_key) do nothing;
