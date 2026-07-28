import { execFileSync } from "node:child_process";
import { access, readdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root=dirname(fileURLToPath(import.meta.url));
const dist=resolve(root,"dist");
const exists=async path=>access(resolve(dist,path)).catch(()=>{throw new Error(`Missing built asset: ${path}`)});
const requireAll=(name,text,markers)=>{for(const marker of markers)if(!text.includes(marker))throw new Error(`Missing built ${name} marker: ${marker}`)};
const forbidAll=(name,text,markers)=>{for(const marker of markers)if(text.includes(marker))throw new Error(`Forbidden built ${name} marker: ${marker}`)};
const required=[
  "index.html","styles.css","invitation.css","offline.css","rule-engine.css","sw.js",
  "modules/config.js","modules/api.js","modules/offline-punch.js","modules/rule-engine.js","modules/access.js",
  "modules/employee-hardening.js","modules/identity-hardening.js","modules/profile-hardening.js","modules/admin-metrics-hardening.js",
  "modules/kiosk-hardening.js","modules/invitation-delivery.js","modules/handlers.js","modules/boot.js",
  "inhaber/index.html","arbeitgeber/index.html","arbeitnehmer/index.html","kiosk/dashboard/index.html"
];
for(const path of required)await exists(path);
const index=await readFile(resolve(dist,"index.html"),"utf8");
requireAll("index",index,["offline.css?v=810","rule-engine.css?v=810","modules/config.js?v=812","modules/offline-punch.js?v=810","modules/rule-engine.js?v=810","modules/api.js?v=811"]);
for(const route of ["inhaber","arbeitgeber","arbeitnehmer","kiosk/dashboard"]){
  const shell=await readFile(resolve(dist,route,"index.html"),"utf8");
  if(shell!==index)throw new Error(`Route shell differs: ${route}`);
}
const config=await readFile(resolve(dist,"modules/config.js"),"utf8");
requireAll("config",config,['workspaceFunction:"aora-v8-pilot-workspace-rules"','kioskWorkspaceFunction:"aora-v8-pilot-kiosk"','version:"8.1.0-pilot"']);
const api=await readFile(resolve(dist,"modules/api.js"),"utf8");
requireAll("API",api,["preparePunchEvent","enqueueOfflinePunch","resolveOfflinePunch","idempotentReplay"]);
const offline=await readFile(resolve(dist,"modules/offline-punch.js"),"utf8");
requireAll("offline",offline,["indexedDB.open","offline_punch_queue",'name:"AES-GCM"',"extractable:false","serviceWorker.register"]);
forbidAll("offline",offline,["localStorage.setItem","payload:event"]);
const rules=await readFile(resolve(dist,"modules/rule-engine.js"),"utf8");
requireAll("rule UI",rules,["Backend-Prüfung aktiv","evaluateShift","shiftRuleDialog","Ausnahme mit Begründung","Arbeitszeitregeln","Regelset Version"]);
const employee=await readFile(resolve(dist,"modules/employee-hardening.js"),"utf8");
forbidAll("employee",employee,["employees?.[0]","employees[0]"]);
const identity=await readFile(resolve(dist,"modules/identity-hardening.js"),"utf8");
forbidAll("identity",identity,["admins?.[0]","admins[0]"]);
const profile=await readFile(resolve(dist,"modules/profile-hardening.js"),"utf8");
forbidAll("profile",profile,["employees?.[0]","employees[0]"]);
const moduleDir=resolve(dist,"modules");
const modules=(await readdir(moduleDir)).filter(file=>file.endsWith(".js")).sort();
if(modules.length<23)throw new Error(`Unexpected module count: ${modules.length}`);
for(const module of modules)execFileSync(process.execPath,["--check",resolve(moduleDir,module)],{stdio:"inherit"});
console.log(`Aora post-build smoke passed: ${modules.length} modules, four role routes, offline queue and work-rule UI.`);