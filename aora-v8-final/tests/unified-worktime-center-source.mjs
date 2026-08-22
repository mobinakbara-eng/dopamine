import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root=resolve(dirname(fileURLToPath(import.meta.url)),"..");
const read=path=>readFile(resolve(root,path),"utf8");
const [index,moduleCss,moduleJs,documentBridge,edge,migration,eventMigration]=await Promise.all([
  read("app/index.html"),
  read("app/worktime-center.css"),
  read("app/modules/worktime-center.js"),
  read("app/modules/worktime-document-bridge.js"),
  read("supabase/functions/aora-v8-worktime-center/index.ts"),
  read("supabase/migrations/20260804125000_unified_worktime_center.sql"),
  read("supabase/migrations/20260804132000_worktime_event_types.sql")
]);

execFileSync(process.execPath,["--check",resolve(root,"app/modules/worktime-center.js")],{stdio:"pipe"});
execFileSync(process.execPath,["--check",resolve(root,"app/modules/worktime-document-bridge.js")],{stdio:"pipe"});

for(const marker of ["worktime-center.css?v=838","modules/worktime-center.js?v=874","modules/worktime-document-bridge.js?v=839"]){
  assert.ok(index.includes(marker),`missing worktime center asset: ${marker}`);
}
assert.ok(index.indexOf("time-correction-clock-hub.js")<index.indexOf("modules/worktime-center.js"),"unified center must load after the legacy correction hub so it can consolidate navigation and views");
assert.ok(index.indexOf("timesheet-document-signing.js")<index.indexOf("modules/worktime-center.js"),"unified center must load after document-scoped Nachweise");
assert.ok(index.indexOf("reports-sync.js")<index.indexOf("modules/worktime-center.js"),"unified center must load after reports so it can embed the canonical report view");
assert.ok(index.indexOf("modules/worktime-center.js")<index.indexOf("modules/worktime-document-bridge.js"),"embedded document bridge must load after the unified worktime state");
assert.ok(index.indexOf("modules/worktime-document-bridge.js")<index.indexOf("modules/handlers.js"),"unified document refresh must be installed before generic handlers and boot");

for(const marker of [
  'const remove=new Set(["time","reports","time-control","approvals",VIEW])',
  '[VIEW,"Arbeitszeit",I.clock]',
  'compliance[1]="Prüfung & Exporte"',
  '["overview","Übersicht"]',
  '["entries","Buchungen"]',
  '["changes","Änderungen"]',
  '["documents","Nachweise"]',
  '["reports","Berichte"]',
  'legacyView("approvals")',
  'legacyView("reports")'
])assert.ok(moduleJs.includes(marker),`missing customer-friendly navigation marker: ${marker}`);

for(const marker of [
  "aora-v8-timesheet-document-signing",
  'payload?.action==="managerOverview"',
  'S?.adminView==="worktime"',
  'data-tab="documents"].active',
  "setTimeout",
  "renderAdmin()"
])assert.ok(documentBridge.includes(marker),`missing embedded Nachweise refresh marker: ${marker}`);

for(const marker of [
  'action==="managerPunch"',
  'action==="managerRequestChange"',
  'action==="decideChange"',
  'source:"manager_direct"',
  'approval_target',
  'change_type',
  'expectedTarget=ctx.accessRole==="employee"?"employee":"manager"',
  'aora_manager_direct_punch_atomic',
  'aora_create_manager_time_change_atomic',
  'aora_decide_time_change_atomic'
])assert.ok(edge.includes(marker),`missing worktime backend marker: ${marker}`);

for(const marker of [
  "Sofort wirksam",
  "keine Mitarbeiterbestätigung",
  "Erst nach Bestätigung wirksam",
  "Der Mitarbeiter sieht Vorher/Nachher",
  'data-worktime-action="employee-decide"',
  'data-worktime-action="open-punch"',
  'data-worktime-action="open-change"',
  "Mitarbeiter → Manager",
  "Manager → Mitarbeiter"
])assert.ok(moduleJs.includes(marker),`missing worktime UX marker: ${marker}`);

assert.match(moduleJs,/catch\(error\)\{[\s\S]*?state\.loadedAt=Date\.now\(\);[\s\S]*?state\.error=/,"failed overview requests must be throttled so the tab UI stays stable instead of entering a render loop");

for(const marker of [
  "add column if not exists approval_target",
  "add column if not exists change_type",
  "aora_create_manager_time_change_atomic",
  "aora_manager_direct_punch_atomic",
  "aora_decide_time_change_atomic",
  "approval_target in ('manager','employee')",
  "change_type in ('edit_entry','create_entry')",
  "grant execute",
  "to service_role"
])assert.ok(migration.includes(marker),`missing migration/security marker: ${marker}`);

for(const marker of [
  "time_entry_events_event_type_check",
  "MANAGER_DIRECT_CLOCK_IN",
  "MANAGER_DIRECT_CLOCK_OUT",
  "MANAGER_DIRECT_PAUSE_START",
  "MANAGER_DIRECT_PAUSE_END",
  "MANAGER_CHANGE_REQUESTED",
  "MANAGER_TIME_CHANGE_CONFIRMED",
  "MANAGER_TIME_CHANGE_REJECTED",
  "EMPLOYEE_TIME_CHANGE_APPROVED",
  "EMPLOYEE_TIME_CHANGE_REJECTED"
])assert.ok(eventMigration.includes(marker),`missing audited event type marker: ${marker}`);

assert.ok(!migration.includes("grant execute on function public.aora_manager_direct_punch_atomic")||migration.includes("revoke all on function public.aora_manager_direct_punch_atomic"),"manager direct punch RPC must be service-role only");
assert.ok(moduleCss.includes("@media(max-width:640px)"),"mobile layout contract is required");
assert.ok(moduleCss.includes(".worktime-diff"),"before/after comparison must have a dedicated responsive layout");
assert.ok(moduleCss.includes(".aora-worktime-dialog"),"direct and approval-required actions need a focused dialog surface");

console.log("Unified worktime center contract passed: one Arbeitszeit navigation, direct audited manager punch, employee-approved historical changes, embedded reports/Nachweise with deterministic refresh and simplified compliance.");
