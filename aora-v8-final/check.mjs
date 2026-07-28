import { execFileSync } from "node:child_process";
import { access, readdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root=dirname(fileURLToPath(import.meta.url));
const moduleDir=resolve(root,"overlay/modules");
const modules=(await readdir(moduleDir)).filter(file=>file.endsWith(".js")).sort();
const requiredOverlayModules=[
  "access.js","admin-metrics-hardening.js","api.js","boot.js","config.js","date-hardening.js",
  "employee-hardening.js","handlers.js","identity-hardening.js","invitation-delivery.js",
  "kiosk-hardening.js","offline-punch.js","owner-routing.js","profile-hardening.js","rule-engine.js"
];
for(const required of requiredOverlayModules){
  if(!modules.includes(required))throw new Error(`Missing required overlay module: ${required}`);
}
for(const file of modules)execFileSync(process.execPath,["--check",resolve(moduleDir,file)],{stdio:"inherit"});
const pkg=JSON.parse(await readFile(resolve(root,"package.json"),"utf8"));
JSON.parse(await readFile(resolve(root,"vercel.json"),"utf8"));

const paths=[
  "overlay/index.html","overlay/offline.css","overlay/rule-engine.css","overlay/sw.js",
  "overlay/modules/config.js","overlay/modules/api.js","overlay/modules/offline-punch.js","overlay/modules/rule-engine.js",
  "supabase/functions/aora-v8-hardening-access/index.ts","supabase/functions/aora-v8-hardening-workspace/index.ts","supabase/functions/aora-v8-hardening-kiosk/index.ts",
  "supabase/functions/aora-v8-pilot-workspace/index.ts","supabase/functions/aora-v8-pilot-kiosk/index.ts","supabase/functions/aora-v8-pilot-workspace-rules/index.ts",
  "supabase/migrations/202607280011_aora_pilot_tenant_location_isolation.sql",
  "supabase/migrations/202607280012_aora_pilot_punch_idempotency.sql",
  "supabase/migrations/202607280013_aora_pilot_work_rule_engine.sql",
  "tests/offline-crypto.mjs"
];
for(const path of paths)await access(resolve(root,path)).catch(()=>{throw new Error(`Missing pilot source: ${path}`)});
const read=path=>readFile(resolve(root,path),"utf8");
const source={
  index:await read("overlay/index.html"),config:await read("overlay/modules/config.js"),api:await read("overlay/modules/api.js"),
  offline:await read("overlay/modules/offline-punch.js"),ruleUi:await read("overlay/modules/rule-engine.js"),sw:await read("overlay/sw.js"),
  tenant:await read("supabase/migrations/202607280011_aora_pilot_tenant_location_isolation.sql"),
  punch:await read("supabase/migrations/202607280012_aora_pilot_punch_idempotency.sql"),
  rules:await read("supabase/migrations/202607280013_aora_pilot_work_rule_engine.sql"),
  pilotWorkspace:await read("supabase/functions/aora-v8-pilot-workspace/index.ts"),
  pilotKiosk:await read("supabase/functions/aora-v8-pilot-kiosk/index.ts"),
  ruleGate:await read("supabase/functions/aora-v8-pilot-workspace-rules/index.ts"),
  employee:await read("overlay/modules/employee-hardening.js"),identity:await read("overlay/modules/identity-hardening.js"),profile:await read("overlay/modules/profile-hardening.js"),
  canonicalKiosk:await read("../aora/modules/kiosk-view.js"),baseCss:await read("../aora/styles.css"),overlayCss:await read("overlay/styles.css"),build:await read("build.mjs")
};
const requireAll=(name,text,markers)=>{for(const marker of markers)if(!text.includes(marker))throw new Error(`Missing ${name} marker: ${marker}`)};
const forbidAll=(name,text,markers)=>{for(const marker of markers)if(text.includes(marker))throw new Error(`Forbidden ${name} marker: ${marker}`)};

requireAll("index",source.index,["offline.css?v=810","rule-engine.css?v=810","modules/config.js?v=812","modules/offline-punch.js?v=810","modules/rule-engine.js?v=810","modules/api.js?v=811"]);
requireAll("config",source.config,['workspaceFunction:"aora-v8-pilot-workspace-rules"','kioskWorkspaceFunction:"aora-v8-pilot-kiosk"','version:"8.1.0-pilot"']);
const configured=source.config.match(/version:\s*"([^"]+)"/)?.[1];
if(configured!==pkg.version)throw new Error(`Version mismatch: ${configured} vs ${pkg.version}`);

requireAll("tenant isolation",source.tenant,["manager_location_access","members read scoped locations","members read scoped employees","manager_can_access_location"]);
requireAll("tenant workspace",source.pilotWorkspace,['tenantSource: "session"','eq("id", session.organization_id)',"Kein Zugriff auf diesen Standort."]);
forbidAll("tenant workspace",source.pilotWorkspace,['.eq("slug", PRIMARY_PILOT_SLUG)']);

requireAll("punch receipts",source.punch,["public.punch_events","primary key (organization_id, event_id)","aora_begin_punch","aora_claim_punch_approval","approval_response_payload"]);
requireAll("pilot kiosk",source.pilotKiosk,["aora_begin_punch","clientEventId","clock_${eventId}","x-aora-punch-replay","idempotentReplay"]);
requireAll("punch client",source.api,["preparePunchEvent","crypto.randomUUID()","enqueueOfflinePunch","markOfflinePunchPending","resolveOfflinePunch","idempotentReplay"]);

requireAll("offline queue",source.offline,["indexedDB.open","offline_punch_queue","device_keys","device_sessions",'name:"AES-GCM"',"extractable:false","ciphertext","additionalData","inspectOfflineQueue","serviceWorker.register"]);
forbidAll("offline queue",source.offline,["localStorage.setItem","payload:event","employeeId:event.employeeId","transition:event.target"]);
requireAll("service worker",source.sw,["aora-punch-sync","offline_punch_queue","device_keys","device_sessions","aora-v8-pilot-kiosk","AORA_PUNCH_SYNCED"]);

requireAll("rule schema",source.rules,["work_rule_sets","work_rules","work_rule_evaluations","aora_evaluate_shift_rules","SHIFT_OVERLAP","MIN_REST_BETWEEN_SHIFTS","DST_TRANSITION","rule_set_version"]);
requireAll("rule gate",source.ruleGate,["SHIFT_EVENTS","evaluateShift","aora_evaluate_shift_rules","Bestätigung und Begründung erforderlich.","ruleSetVersion","ruleEvaluationId"]);
requireAll("rule UI",source.ruleUi,["Backend-Prüfung aktiv","evaluateShift","shiftRuleDialog","Ausnahme mit Begründung","Arbeitszeitregeln","Regelset Version"]);

forbidAll("employee identity",source.employee,["S.state.employees?.[0]","S.state.employees[0]"]);
forbidAll("admin identity",source.identity,["admins?.[0]","admins[0]"]);
forbidAll("profile identity",source.profile,["employees?.[0]","employees[0]"]);
if(source.canonicalKiosk.includes("aora-v8-hardening"))throw new Error("Canonical aora kiosk was modified");
requireAll("canonical style",source.baseCss,["--black:#000","--white:#fff","--radius:16px",".aora-logo"]);
for(const selector of [/(^|})\s*:root\s*{/m,/(^|})\s*body\s*[{,]/m,/(^|})\s*\.aora-logo\s*{/m])if(selector.test(source.overlayCss))throw new Error(`Overlay replaces canonical selector: ${selector}`);
if(!source.build.includes('`${originalCss}\\n\\n${extensionCss}\\n`'))throw new Error("Canonical CSS append order changed");

console.log(`Aora 8.1.0 pilot gate passed (${modules.length} overlay modules): tenant isolation, durable punch integrity, encrypted offline queue and versioned work rules.`);