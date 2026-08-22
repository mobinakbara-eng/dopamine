-- Additive catalog media support. Existing inventory/workforce data is untouched.
alter table public.inventory_items
  add column if not exists image_path text;

alter table public.inventory_suppliers
  add column if not exists image_path text;

comment on column public.inventory_items.image_path is
  'Private storage path in inventory-media. Never expose as a public URL.';
comment on column public.inventory_suppliers.image_path is
  'Private storage path in inventory-media. Never expose as a public URL.';

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values(
  'inventory-media',
  'inventory-media',
  false,
  8388608,
  array['image/jpeg','image/png','image/webp','image/heic','image/heif']::text[]
)
on conflict (id) do update
set public=false,
    file_size_limit=excluded.file_size_limit,
    allowed_mime_types=excluded.allowed_mime_types;
