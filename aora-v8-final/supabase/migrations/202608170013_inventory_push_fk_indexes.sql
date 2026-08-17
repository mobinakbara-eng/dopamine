create index if not exists inventory_supplier_items_pack_unit_fk_idx
  on public.inventory_supplier_items (organization_id, pack_unit_id)
  where pack_unit_id is not null;

create index if not exists notification_push_targets_delivery_fk_idx
  on public.notification_push_delivery_targets (delivery_id);

create index if not exists notification_push_targets_subscription_fk_idx
  on public.notification_push_delivery_targets (subscription_id);
