begin;
update public.feature_flags
set config=coalesce(config,'{}'::jsonb) || '{"defaultProfile":"brother_62x29_300","primaryDevice":"ipad","printTransport":"airprint"}'::jsonb,
    updated_at=now()
where flag_key='inventory_printing';
commit;
