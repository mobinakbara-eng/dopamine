-- Task lifecycle mutations are authenticated by the Edge Function and must not
-- be callable directly through PostgREST by anon/authenticated clients.
revoke all on function public.aora_set_task_template_active(uuid,text,boolean,text)
from public, anon, authenticated;
revoke all on function public.aora_soft_delete_task_template(uuid,text,text,text)
from public, anon, authenticated;
revoke all on function public.aora_cancel_task_instance(uuid,text,text,text)
from public, anon, authenticated;
revoke all on function public.aora_soft_delete_task_instance(uuid,text,text,text)
from public, anon, authenticated;

grant execute on function public.aora_set_task_template_active(uuid,text,boolean,text) to service_role;
grant execute on function public.aora_soft_delete_task_template(uuid,text,text,text) to service_role;
grant execute on function public.aora_cancel_task_instance(uuid,text,text,text) to service_role;
grant execute on function public.aora_soft_delete_task_instance(uuid,text,text,text) to service_role;
