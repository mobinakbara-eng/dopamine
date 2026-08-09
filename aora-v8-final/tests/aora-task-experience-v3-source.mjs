import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root=resolve(import.meta.dirname,"..");
const read=path=>readFile(resolve(root,path),"utf8");
const [index,ui,styles,media]=await Promise.all([
  read("app/index.html"),
  read("app/modules/task-experience-v3.js"),
  read("app/task-experience-v3.css"),
  read("supabase/functions/aora-v8-task-media/index.ts")
]);

for(const marker of ["task-experience-v3.css?v=849","modules/task-experience-v3.js?v=849"]){
  if(!index.includes(marker))throw new Error(`Task experience asset missing: ${marker}`);
}
if(index.indexOf("modules/task-experience-v3.js?v=849")<index.indexOf("modules/domain-patch-routing.js?v=827")){
  throw new Error("Task experience v3 must load after domain patch routing.");
}
if(index.indexOf("modules/task-experience-v3.js?v=849")>index.indexOf("modules/handlers.js?v=822")){
  throw new Error("Task experience v3 must load before handlers initialize.");
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
  'case"viewMedia"'
]){
  if(!media.includes(marker))throw new Error(`Task media backend marker missing: ${marker}`);
}
for(const marker of [".aora-composer-media",".aora-task-photo-proof",".aora-photo-upload","@media(max-width:680px)"]){
  if(!styles.includes(marker))throw new Error(`Task photo style marker missing: ${marker}`);
}

console.log("Aora resilient task loading, manager reference photo and employee photo proof source gate passed.");
