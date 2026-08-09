import assert from "node:assert/strict";
import fs from "node:fs";

const domain = fs.readFileSync(
  new URL("../supabase/functions/aora-v8-domain-api/index.ts", import.meta.url),
  "utf8",
);
const rules = fs.readFileSync(
  new URL("../supabase/functions/aora-v8-pilot-workspace-rules/index.ts", import.meta.url),
  "utf8",
);
const pilotWorkspace = fs.readFileSync(
  new URL("../supabase/functions/aora-v8-pilot-workspace/index.ts", import.meta.url),
  "utf8",
);
const migration = fs.readFileSync(
  new URL("../supabase/migrations/202608050100_task_answer_employee_scope.sql", import.meta.url),
  "utf8",
);

function includesAll(source, fragments, label) {
  for (const fragment of fragments) {
    assert.ok(source.includes(fragment), `${label}: missing ${fragment}`);
  }
}

includesAll(domain, [
  "async function requireEmployeeLocation",
  "await requireEmployeeLocation(ctx,String(shift.employeeId),String(shift.locationId))",
  '.from("employee_location_access")',
], "shift employee/location binding");

includesAll(domain, [
  '.from("staffing_requirements").select("*").eq("organization_id",ctx.organization.id).eq("location_id",locationId)',
  "const scopedAvailability=(availabilityResult.data||[]).filter",
  "availability:scopedAvailability",
], "schedule board location scope");

includesAll(domain, [
  "return(data||[]).filter((template:any)",
  'ctx.accessRole==="manager"&&!locationId',
  'existing.location_id==null||!ctx.allowedLocationIds.includes(String(existing.location_id))',
  '"template_relocation_forbidden"',
], "task template manager scope");

includesAll(domain, [
  "const scoped=(data||[]).filter((task:any)=>ctx.accessRole===\"owner\"||ctx.allowedLocationIds.includes(String(task.location_id)))",
  'ctx.accessRole==="kiosk"',
  '"kiosk_task_write_forbidden"',
  'async function saveTaskAnswer(ctx:any,body:any){requireRole(ctx,["employee"])',
  'async function submitTask(ctx:any,body:any){requireRole(ctx,["employee"])',
  'onConflict:"organization_id,task_instance_id,template_item_id,employee_id"',
  'aora_update_task_assignment_progress',
  'updateTaskAssignmentProgress(ctx,taskId,"in_progress"',
  'updateTaskAssignmentProgress(ctx,taskId,"completed"',
], "task read/write actor scope");

includesAll(rules, [
  "async function requireEmployeeLocation",
  'from("employee_location_access")',
  "await requireEmployeeLocation(ctx, String(shift.employeeId), String(shift.locationId))",
], "pilot rule employee/location binding");

includesAll(pilotWorkspace, [
  "function scopeEmployeeState",
  "employees: [employee]",
  "clockRequests: source.clockRequests.filter",
  'body.action === "load" && ctx.accessRole === "employee"',
  '.select("state,revision")',
  "? scopeEmployeeState(ctx, canonicalState)",
], "pilot employee canonical state scope");

assert.match(
  migration,
  /primary key\s*\(\s*organization_id,\s*task_instance_id,\s*template_item_id,\s*employee_id\s*\)/s,
  "task answer primary key must include employee_id",
);

includesAll(migration, [
  "create or replace function public.aora_update_task_assignment_progress",
  "for update",
  "assignment.employee_id = p_employee_id",
  "assignment.status <> 'cancelled'",
  "count(*) filter (where assignment.status <> 'completed')",
  "when coalesce(p_review_required, false) then 'submitted'",
  "revoke all on function public.aora_update_task_assignment_progress",
], "multi-assignee task aggregation");

console.log("backend tenancy source contracts passed");
