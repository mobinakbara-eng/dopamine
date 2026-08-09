import assert from "node:assert/strict";
import fs from "node:fs";

const index=fs.readFileSync(new URL("../app/index.html",import.meta.url),"utf8");
const composer=fs.readFileSync(new URL("../app/modules/manager-task-composer-v3.js",import.meta.url),"utf8");
const lifecycle=fs.readFileSync(new URL("../app/modules/task-lifecycle-v4.js",import.meta.url),"utf8");
const edge=fs.readFileSync(new URL("../supabase/functions/aora-v8-task-lifecycle/index.ts",import.meta.url),"utf8");
const migration=fs.readFileSync(new URL("../supabase/migrations/202608091335_task_template_and_instance_lifecycle.sql",import.meta.url),"utf8");
const permissionMigration=fs.readFileSync(new URL("../supabase/migrations/202608091455_restrict_task_lifecycle_rpc.sql",import.meta.url),"utf8");

assert.match(index,/task-experience-v3\.js\?v=849[\s\S]*manager-task-composer-v3\.js\?v=850[\s\S]*task-lifecycle-v4\.js\?v=850/);
assert.match(index,/task-lifecycle-v4\.css\?v=850/);

for(const marker of[
  'data-composer="manual-v3"',
  "Foto zur Aufgabe",
  'name="managerReference"',
  "Foto-Nachweis vom Mitarbeiter erforderlich",
  'name="photoEvidenceRequired"',
  'name="employeeIds"',
  'name="required"',
  'name="date"',
  'name="dueTime"',
  'mediaCall("configure"',
  'uploadReference(taskId,referenceFile)',
  'uCall("createManualTask"'
])assert.ok(composer.includes(marker),`Missing composer contract: ${marker}`);
assert.ok(!composer.includes("Clock-out Policy"));
assert.ok(!composer.includes('name="priority"'));
assert.ok(!composer.includes('name="shiftId"'));

for(const marker of[
  "setTemplateActive",
  "deleteTemplate",
  "cancelTask",
  "deleteTask",
  "Deaktivieren",
  "Aktivieren",
  "Abbrechen",
  "Soft-Delete"
])assert.ok(lifecycle.includes(marker),`Missing lifecycle UI contract: ${marker}`);

for(const marker of[
  'action==="setTemplateActive"',
  'action==="deleteTemplate"',
  'action==="cancelTask"',
  'action==="deleteTask"',
  "manager_required",
  "global_template_forbidden",
  "aora_set_task_template_active",
  "aora_soft_delete_task_template",
  "aora_cancel_task_instance",
  "aora_soft_delete_task_instance"
])assert.ok(edge.includes(marker),`Missing lifecycle Edge contract: ${marker}`);

for(const marker of[
  "create or replace function public.aora_set_task_template_active",
  "_aoraPausedByTemplate",
  "create or replace function public.aora_soft_delete_task_template",
  "deleted_at=coalesce(deleted_at,v_now)",
  "create or replace function public.aora_cancel_task_instance",
  "blocking_clockout=false",
  "create or replace function public.aora_soft_delete_task_instance",
  "related_entity_type='task'",
  "grant execute on function public.aora_set_task_template_active"
])assert.ok(migration.includes(marker),`Missing lifecycle SQL contract: ${marker}`);

for(const marker of[
  "revoke all on function public.aora_set_task_template_active",
  "revoke all on function public.aora_soft_delete_task_template",
  "revoke all on function public.aora_cancel_task_instance",
  "revoke all on function public.aora_soft_delete_task_instance",
  "from public, anon, authenticated",
  "to service_role"
])assert.ok(permissionMigration.includes(marker),`Missing task lifecycle RPC permission hardening: ${marker}`);

console.log("Aora task lifecycle v4 source gate passed.");
