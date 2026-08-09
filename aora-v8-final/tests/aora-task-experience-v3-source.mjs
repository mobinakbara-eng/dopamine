import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root=resolve(import.meta.dirname,"..");
const read=path=>readFile(resolve(root,path),"utf8");
const [index,ui,styles,media,composer,lifecycle,lifecycleEdge,lifecycleSql]=await Promise.all([
  read("app/index.html"),
  read("app/modules/task-experience-v3.js"),
  read("app/task-experience-v3.css"),
  read("supabase/functions/aora-v8-task-media/index.ts"),
  read("app/modules/manager-task-composer-v3.js"),
  read("app/modules/task-lifecycle-v4.js"),
  read("supabase/functions/aora-v8-task-lifecycle/index.ts"),
  read("supabase/migrations/202608091335_task_template_and_instance_lifecycle.sql")
]);

for(const marker of ["task-experience-v3.css?v=849","modules/task-experience-v3.js?v=849","task-lifecycle-v4.css?v=850","modules/manager-task-composer-v3.js?v=850","modules/task-lifecycle-v4.js?v=850"]){
  if(!index.includes(marker))throw new Error(`Task experience asset missing: ${marker}`);
}
if(index.indexOf("modules/task-experience-v3.js?v=849")<index.indexOf("modules/domain-patch-routing.js?v=827")){
  throw new Error("Task experience v3 must load after domain patch routing.");
}
if(index.indexOf("modules/manager-task-composer-v3.js?v=850")<index.indexOf("modules/task-experience-v3.js?v=849")){
  throw new Error("Intrinsic manager task composer must load after task experience v3.");
}
if(index.indexOf("modules/task-lifecycle-v4.js?v=850")<index.indexOf("modules/manager-task-composer-v3.js?v=850")){
  throw new Error("Task lifecycle controls must load after the final manager composer.");
}
if(index.indexOf("modules/task-lifecycle-v4.js?v=850")>index.indexOf("modules/handlers.js?v=822")){
  throw new Error("Task lifecycle UI must load before handlers initialize.");
}

for(const marker of [
  "employeeAttemptKey",
  "managerAttemptKey",
  "Aufgaben konnten nicht geladen werden.",
  'data-aora-task-retry="manager"',
  "Foto zur Aufgabe",
  "Foto-Nachweis vom Mitarbeiter erforderlich",
  "Foto aufnehmen / auswählen",
  'capture="environment"',
  "manager_reference",
  "employee_proof",
  'action==="submitTask"',
  'mediaCall("configure"'
]){
  if(!ui.includes(marker))throw new Error(`Task experience behavior missing: ${marker}`);
}
for(const forbidden of ["setInterval(","location.reload()"]){
  if(ui.includes(forbidden))throw new Error(`Task loading recovery must not spin/reload automatically: ${forbidden}`);
}

for(const marker of [
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
  "uploadReference(taskId,referenceFile)",
  'uCall("createManualTask"'
]){
  if(!composer.includes(marker))throw new Error(`Intrinsic manager composer marker missing: ${marker}`);
}
for(const forbidden of ['name="priority"','name="shiftId"',"Clock-out Policy"]){
  if(composer.includes(forbidden))throw new Error(`Manager composer should not expose technical control: ${forbidden}`);
}

for(const marker of ["setTemplateActive","deleteTemplate","cancelTask","deleteTask","Deaktivieren","Aktivieren","Abbrechen","Soft-Delete"]){
  if(!lifecycle.includes(marker))throw new Error(`Task lifecycle UI marker missing: ${marker}`);
}
for(const marker of ['action==="setTemplateActive"','action==="deleteTemplate"','action==="cancelTask"','action==="deleteTask"',"manager_required","global_template_forbidden","aora_set_task_template_active","aora_soft_delete_task_template","aora_cancel_task_instance","aora_soft_delete_task_instance"]){
  if(!lifecycleEdge.includes(marker))throw new Error(`Task lifecycle Edge marker missing: ${marker}`);
}
for(const marker of ["aora_set_task_template_active","_aoraPausedByTemplate","aora_soft_delete_task_template","aora_cancel_task_instance","blocking_clockout=false","aora_soft_delete_task_instance","related_entity_type='task'"]){
  if(!lifecycleSql.includes(marker))throw new Error(`Task lifecycle SQL marker missing: ${marker}`);
}

for(const marker of [
  "__aora_manager_reference__",
  "__aora_employee_photo__",
  "photoEvidenceRequired",
  "checklist-evidence",
  "createSignedUploadUrl",
  "createSignedUrl",
  "photo_evidence_required",
  'case"submitTask"',
  'case"configure"',
  'case"prepareUpload"',
  'case"confirmUpload"',
  'case"listMedia"',
  'case"viewMedia"',
  'case"deleteMedia"',
  "media_delete_failed"
]){
  if(!media.includes(marker))throw new Error(`Task media backend marker missing: ${marker}`);
}
const compat=await read("supabase/functions/aora-v8-domain-api-compat/index.ts");
for(const marker of ["photo_evidence_required","__aora_employee_photo__","aora-domain-compat-failed","action:action||\"unknown\""]){
  if(!compat.includes(marker))throw new Error(`Direct task completion/observability marker missing: ${marker}`);
}
for(const marker of [".aora-composer-media",".aora-task-photo-proof",".aora-photo-upload","@media(max-width:680px)"]){
  if(!styles.includes(marker))throw new Error(`Task photo style marker missing: ${marker}`);
}

console.log("Aora task loading, intrinsic task photos, employee proof and lifecycle source gate passed.");
