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
  "index.html","styles.css","invitation.css","offline.css","rule-engine.css","compliance.css","sw.js",
  "modules/config.js","modules/api.js","modules/offline-punch.js","modules/rule-engine.js","modules/access.js",
  "modules/realtime.js","modules/runtime-hardening.js","modules/accessibility-hardening.js","modules/monitoring.js","modules/compliance.js",
  "modules/employee-hardening.js","modules/identity-hardening.js","modules/profile-hardening.js","modules/admin-metrics-hardening.js",
  "modules/kiosk-hardening.js","modules/invitation-delivery.js","modules/handlers.js","modules/boot.js",
  "inhaber/index.html","arbeitgeber/index.html","arbeitnehmer/index.html","kiosk/dashboard/index.html"
];
for(const path of required)await exists(path);
const index=await readFile(resolve(dist,"index.html"),"utf8");
requireAll("index",index,["offline.css?v=810","rule-engine.css?v=810","compliance.css?v=814","modules/config.js?v=814","modules/realtime.js?v=814","modules/runtime-hardening.js?v=815","modules/accessibility-hardening.js?v=817","modules/monitoring.js?v=813","modules/compliance.js?v=813"]);
for(const route of ["inhaber","arbeitgeber","arbeitnehmer","kiosk/dashboard"]){const shell=await readFile(resolve(dist,route,"index.html"),"utf8");if(shell!==index)throw new Error(`Route shell differs: ${route}`)}
const config=await readFile(resolve(dist,"modules/config.js"),"utf8");
requireAll("config",config,['DEFAULT_WORKSPACE_SLUG="aora-demo"','workspaceFunction:"aora-v8-pilot-workspace-rules"','kioskWorkspaceFunction:"aora-v8-pilot-kiosk"','complianceFunction:"aora-v8-pilot-compliance"','realtimeBroadcastFunction:"aora-v8-pilot-realtime-broadcast"','realtimeFallbackMs:60000','version:"8.1.0-pilot"']);
const api=await readFile(resolve(dist,"modules/api.js"),"utf8");
requireAll("API",api,["preparePunchEvent","enqueueOfflinePunch","resolveOfflinePunch","idempotentReplay","text/plain;charset=UTF-8"]);
const offline=await readFile(resolve(dist,"modules/offline-punch.js"),"utf8");
requireAll("offline",offline,["indexedDB.open","offline_punch_queue",'name:"AES-GCM"',"extractable:false","serviceWorker.register"]);
forbidAll("offline",offline,["localStorage.setItem","payload:event"]);
const rules=await readFile(resolve(dist,"modules/rule-engine.js"),"utf8");
requireAll("rule UI",rules,["Backend-PrÃ¼fung aktiv","evaluateShift","shiftRuleDialog","Ausnahme mit BegrÃ¼ndung","Arbeitszeitregeln","Regelset Version"]);
const realtime=await readFile(resolve(dist,"modules/realtime.js"),"utf8");
requireAll("realtime",realtime,["workspace-change","aoraSha256Hex","SUBSCRIBED","realtimeFallbackMs","__aoraLastRealtimeEvent"]);
const runtime=await readFile(resolve(dist,"modules/runtime-hardening.js"),"utf8");
requireAll("runtime",runtime,["workspaceSlug:CFG.slug","downloadCompliance","connectWorkspaceRealtime","notifyWorkspaceRealtime","realtimeBroadcastFunction",'AORA_COMPLIANCE_FUNCTION="aora-v8-pilot-compliance-proxy"']);
const accessibility=await readFile(resolve(dist,"modules/accessibility-hardening.js"),"utf8");
requireAll("accessibility",accessibility,["label.htmlFor=control.id",'setAttribute("role","dialog")',"MutationObserver"]);
const compliance=await readFile(resolve(dist,"modules/compliance.js"),"utf8");
requireAll("compliance",compliance,["Compliance & Korrekturen","requestCorrection","decideCorrection"]);
const complianceCss=await readFile(resolve(dist,"compliance.css"),"utf8");
requireAll("mobile compliance CSS",complianceCss,["employee-correction-fab","bottom:calc(81px + env(safe-area-inset-bottom,0px))","z-index:60"]);
const handlers=await readFile(resolve(dist,"modules/handlers.js"),"utf8");
requireAll("kiosk feedback",handlers,["TOGGLE_KIOSK_LOCK","Kiosk-GerÃ¤t wurde gesperrt.","Kiosk-GerÃ¤t konnte nicht aktualisiert werden."]);
const employee=await readFile(resolve(dist,"modules/employee-hardening.js"),"utf8");
forbidAll("employee",employee,["employees?.[0]","employees[0]"]);
const identity=await readFile(resolve(dist,"modules/identity-hardening.js"),"utf8");
forbidAll("identity",identity,["admins?.[0]","admins[0]"]);
const profile=await readFile(resolve(dist,"modules/profile-hardening.js"),"utf8");
forbidAll("profile",profile,["employees?.[0]","employees[0]"]);
const moduleDir=resolve(dist,"modules");
const modules=(await readdir(moduleDir)).filter(file=>file.endsWith(".js")).sort();
if(modules.length<27)throw new Error(`Unexpected module count: ${modules.length}`);
for(const module of modules)execFileSync(process.execPath,["--check",resolve(moduleDir,module)],{stdio:"inherit"});
console.log(`Aora post-build smoke passed: ${modules.length} modules, four role routes, authenticated Realtime broadcast, mobile correction action, origin-safe compliance bridge, offline queue and work-rule UI.`);

