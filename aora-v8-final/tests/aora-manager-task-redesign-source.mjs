import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root=resolve(import.meta.dirname,"..");
const read=path=>readFile(resolve(root,path),"utf8");
const [index,ui,styles,featureActions]=await Promise.all([
  read("app/index.html"),
  read("app/modules/manager-task-redesign.js"),
  read("app/manager-task-redesign.css"),
  read("supabase/functions/aora-v8-feature-actions/index.ts")
]);

for(const marker of ["manager-task-redesign.css?v=846","modules/manager-task-redesign.js?v=846"]){
  if(!index.includes(marker))throw new Error(`Manager task redesign asset missing from index: ${marker}`);
}
if(index.indexOf("modules/manager-task-redesign.js?v=846")<index.indexOf("modules/unified-features.js?v=823")){
  throw new Error("Manager task redesign must load after unified task features.");
}
if(index.indexOf("modules/manager-task-redesign.js?v=846")>index.indexOf("modules/handlers.js?v=822")){
  throw new Error("Manager task redesign must load before click handlers are initialized.");
}
for(const marker of [
  "Aufgabe erstellen",
  "Im Dienst auswählen",
  'name="employeeIds"',
  'name="priority"',
  'name="shiftId"',
  "idempotencyKey",
  "taskLocalIso",
  "Hinweis vom Manager"
]){
  if(!ui.includes(marker))throw new Error(`Manager task redesign UI marker missing: ${marker}`);
}
for(const forbidden of ["Offen / First Claim"]){
  if(ui.includes(forbidden))throw new Error(`Broken manual assignment mode must not be exposed: ${forbidden}`);
}
for(const marker of [
  "validateManualAssignees",
  "assignee_location_forbidden",
  "template_location_forbidden",
  "deadline_in_past",
  "invalid_priority",
  "manual:${idempotencyKey}",
  "instructions,priority,shiftId,timezone,idempotencyKey"
]){
  if(!featureActions.includes(marker))throw new Error(`Manual task backend hardening marker missing: ${marker}`);
}
for(const marker of [".aora-task-create-dialog",".aora-employee-list",".aora-task-create-footer","@media(max-width:560px)"]){
  if(!styles.includes(marker))throw new Error(`Manager task redesign style marker missing: ${marker}`);
}
console.log("Aora manager task redesign source gate passed.");
