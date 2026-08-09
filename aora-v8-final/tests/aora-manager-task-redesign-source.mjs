import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root=resolve(import.meta.dirname,"..");
const read=path=>readFile(resolve(root,path),"utf8");
const [index,ui,styles,automationUi,automationStyles,featureActions,scheduler]=await Promise.all([
  read("app/index.html"),
  read("app/modules/manager-task-redesign.js"),
  read("app/manager-task-redesign.css"),
  read("app/modules/manager-task-automation.js"),
  read("app/manager-task-automation.css"),
  read("supabase/functions/aora-v8-feature-actions/index.ts"),
  read("supabase/functions/aora-v8-task-scheduler/scheduler.ts")
]);

for(const marker of ["manager-task-redesign.css?v=846","modules/manager-task-redesign.js?v=846","manager-task-automation.css?v=847","modules/manager-task-automation.js?v=847"]){
  if(!index.includes(marker))throw new Error(`Manager task redesign asset missing from index: ${marker}`);
}
if(index.indexOf("modules/manager-task-redesign.js?v=846")<index.indexOf("modules/unified-features.js?v=823")){
  throw new Error("Manager task redesign must load after unified task features.");
}
if(index.indexOf("modules/manager-task-automation.js?v=847")<index.indexOf("modules/manager-task-redesign.js?v=846")){
  throw new Error("Task automation redesign must load after manual task redesign.");
}
if(index.indexOf("modules/manager-task-automation.js?v=847")>index.indexOf("modules/handlers.js?v=822")){
  throw new Error("Manager task automation must load before click handlers are initialized.");
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
for(const marker of [
  "Automatisierung erstellen",
  "Feste Uhrzeit",
  "Genau 1 Person aus der laufenden Schicht",
  "Faire Rotation",
  'name="weekdays"',
  'assignmentConfig',
  'selection:String(form.get("selection")||"least_recent")'
]){
  if(!automationUi.includes(marker))throw new Error(`Recurring task automation UI marker missing: ${marker}`);
}
for(const marker of [".aora-automation-dialog",".aora-weekday-picker",".aora-automation-summary"]){
  if(!automationStyles.includes(marker))throw new Error(`Recurring task automation style marker missing: ${marker}`);
}
for(const marker of [
  "leastRecentlyAssigned",
  'strategy==="one_on_shift"',
  'config.selection||"least_recent"',
  'ruleId:rule.id',
  'scheduledFor>=bounds.start&&scheduledFor<=bounds.end'
]){
  if(!scheduler.includes(marker))throw new Error(`Fair on-shift scheduler marker missing: ${marker}`);
}
console.log("Aora manager task redesign and recurring on-shift automation source gate passed.");
