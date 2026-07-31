begin;
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid='public.task_answers'::regclass
      and conname='task_answers_task_instance_fkey'
  ) then
    alter table public.task_answers
      add constraint task_answers_task_instance_fkey
      foreign key(organization_id,task_instance_id)
      references public.task_instances(organization_id,id)
      on delete cascade;
  end if;
end $$;
create index if not exists task_answers_instance_idx
  on public.task_answers(organization_id,task_instance_id,template_item_id);
commit;
