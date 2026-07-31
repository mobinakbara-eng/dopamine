begin;
alter table public.task_generation_keys alter column task_instance_id drop not null;
comment on column public.task_generation_keys.task_instance_id is 'Filled only after the reserved idempotency key successfully creates its task instance.';
commit;
