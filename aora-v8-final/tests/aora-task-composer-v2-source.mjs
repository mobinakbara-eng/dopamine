import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root=resolve(import.meta.dirname,"..");
const read=path=>readFile(resolve(root,path),"utf8");
const [index,composer,styles,featureActions,clockoutMigration,scheduler,sharedMigration]=await Promise.all([
  read("app/index.html"),
  read("app/modules/manager-task-composer-v2.js"),
  read("app/manager-task-composer-v2.css"),
  read("supabase/functions/aora-v8-feature-actions/index.ts"),
  read("supabase/migrations/202608091255_mandatory_task_clockout_scope.sql"),
  read("supabase/functions/aora-v8-task-scheduler/scheduler.ts"),
  read("supabase/migrations/202608091130_shared_on_shift_tasks.sql")
]);

for(const marker of ["manager-task-composer-v2.css?v=848","modules/manager-task-composer-v2.js?v=848"]){
  if(!index.includes(marker))throw new Error(`Task composer asset missing: ${marker}`);
}
if(index.indexOf("modules/manager-task-composer-v2.js?v=848")<index.indexOf("modules/manager-task-automation.js?v=847")){
  throw new Error("Task composer v2 must override previous manager task dialogs.");
}
if(index.indexOf("modules/manager-task-composer-v2.js?v=848")>index.indexOf("modules/handlers.js?v=822")){
  throw new Error("Task composer v2 must load before handlers initialize.");
}

for(const marker of [
  "Aufgabe erstellen",
  "Nur das Nötige",
  "Pflichtaufgabe?",
  "Als Pflichtaufgabe markieren",
  "erst ausstempeln",
  'name="required"',
  "priority:\"normal\"",
  "shiftId:null",
  "Automatische Aufgabe",
  "Alle im Dienst sehen sie · 1 Person erledigt für alle",
  "Jede Person im Dienst muss sie erledigen",
  "Nur 1 Person im Dienst · faire Rotation",
  'clockoutPolicy:required?"MANAGER_OVERRIDE":"WARN_ONLY"',
  'assignmentStrategy:strategy'
]){
  if(!composer.includes(marker))throw new Error(`Task composer behavior missing: ${marker}`);
}
for(const forbidden of [
  "Clock-out Policy",
  '<option value="STRICT_BLOCK"',
  '<option value="MANAGER_OVERRIDE"'
]){
  if(composer.includes(forbidden))throw new Error(`Technical policy leaked into manager UI: ${forbidden}`);
}

for(const marker of [
  "templateBlocksClockout",
  "body.required==null?templateBlocksClockout",
  "p_blocking_clockout:required",
  "required,clockoutPolicy:required?\"MANAGER_OVERRIDE\":\"WARN_ONLY\"",
  "shift_date_mismatch"
]){
  if(!featureActions.includes(marker))throw new Error(`Manual mandatory backend marker missing: ${marker}`);
}

for(const marker of [
  "i.blocking_clockout",
  "i.scheduled_for is null or i.scheduled_for<=now()",
  "p_shift_id is null or i.shift_id is null or i.shift_id=p_shift_id",
  "a.status<>'cancelled'",
  "coalesce(nullif(i.payload->>'title',''),t.title)"
]){
  if(!clockoutMigration.includes(marker))throw new Error(`Clockout gate compatibility marker missing: ${marker}`);
}

for(const marker of ["shared_on_shift","aora_create_shared_scheduled_task_atomic","p_blocking_clockout"]){
  if(!scheduler.includes(marker)&&!sharedMigration.includes(marker))throw new Error(`Shared task contract missing: ${marker}`);
}
for(const marker of [".aora-composer-dialog",".aora-composer-people",".aora-composer-required","@media(max-width:680px)"]){
  if(!styles.includes(marker))throw new Error(`Task composer responsive style marker missing: ${marker}`);
}

console.log("Aora manager task composer v2 mandatory/shared source gate passed.");