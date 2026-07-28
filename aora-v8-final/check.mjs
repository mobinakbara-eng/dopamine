import { execFileSync } from "node:child_process";
import { access, readdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root=dirname(fileURLToPath(import.meta.url));
const moduleDir=resolve(root,"overlay/modules");
const modules=(await readdir(moduleDir)).filter(file=>file.endsWith(".js")).sort();
const requiredOverlayModules=[
  "access.js","admin-metrics-hardening.js","api.js","boot.js","compliance.js","config.js","date-hardening.js",
  "employee-hardening.js","handlers.js","identity-hardening.js","invitation-delivery.js","kiosk-hardening.js",
  "monitoring.js","offline-punch.js","owner-routing.js","profile-hardening.js","realtime.js","rule-engine.js","runtime-hardening.js"
];
for(const required of requiredOverlayModules){if(!modules.includes(required))throw new Error(`Missing required overlay module: ${required}`)}
for(const file of modules)execFileSync(process.execPath,["--check",resolve(moduleDir,file)],{stdio:"inherit"});
const pkg=JSON.parse(await readFile(resolve(root,"package.json"),"utf8"));
JSON.parse(await readFile(resolve(root,"vercel.json"),"utf8"));

const paths=[
  "overlay/index.html","overlay/offline.css","overlay/rule-engine.css","overlay/compliance.css","overlay/sw.js",
  "overlay/modules/config.js","overlay/modules/api.js","overlay/modules/offline-punch.js","overlay/modules/rule-engine.js",
  "overlay/modules/realtime.js","overlay/modules/runtime-hardening.js","overlay/modules/monitoring.js","overlay/modules/compliance.js","overlay/modules/handlers.js",
  "supabase/functions/aora-v8-hardening-access/index.ts","supabase/functions/aora-v8-hardening-workspace/index.ts","supabase/functions/aora-v8-hardening-kiosk/index.ts",
  "supabase/functions/aora-v8-pilot-access/index.ts","supabase/functions/aora-v8-pilot-workspace/index.ts","supabase/functions/aora-v8-pilot-kiosk/index.ts","supabase/functions/aora-v8-pilot-workspace-rules/index.ts",
  "supabase/functions/aora-v8-pilot-ci-bootstrap/index.ts","supabase/functions/aora-v8-pilot-realtime-broadcast/index.ts",
  "supabase/functions/aora-v8-pilot-monitor/index.ts","supabase/functions/aora-v8-pilot-compliance-proxy/index.ts","supabase/functions/aora-v8-pilot-onboarding/index.ts",
  "supabase/migrations/202607280011_aora_pilot_tenant_location_isolation.sql",
  "supabase/migrations/202607280012_aora_pilot_punch_idempotency.sql",
  "supabase/migrations/202607280013_aora_pilot_work_rule_engine.sql",
  "supabase/migrations/202607280700_aora_pilot_security_and_qa_redaction.sql",
  "supabase/migrations/202607280800_aora_ci_oidc_tenant_bootstrap.sql",
  "supabase/migrations/202607280900_aora_realtime_rest_bridge.sql",
  "supabase/migrations/202607280910_aora_ci_ledger_cleanup_exception.sql",
  "tests/offline-crypto.mjs","tests/aora-four-role.spec.mjs","playwright.config.mjs","../.github/workflows/aora-v8-pilot-ci.yml"
];
for(const path of paths)await access(resolve(root,path)).catch(()=>{throw new Error(`Missing pilot source: ${path}`)});
const read=path=>readFile(resolve(root,path),"utf8");
const source={
  index:await read("overlay/index.html"),config:await read("overlay/modules/config.js"),api:await read("overlay/modules/api.js"),
  offline:await read("overlay/modules/offline-punch.js"),ruleUi:await read("overlay/modules/rule-engine.js"),sw:await read("overlay/sw.js"),
  realtime:await read("overlay/modules/realtime.js"),runtime:await read("overlay/modules/runtime-hardening.js"),monitoring:await read("overlay/modules/monitoring.js"),compliance:await read("overlay/modules/compliance.js"),handlers:await read("overlay/modules/handlers.js"),complianceCss:await read("overlay/compliance.css"),boot:await read("overlay/modules/boot.js"),
  tenant:await read("supabase/migrations/202607280011_aora_pilot_tenant_location_isolation.sql"),punch:await read("supabase/migrations/202607280012_aora_pilot_punch_idempotency.sql"),rules:await read("supabase/migrations/202607280013_aora_pilot_work_rule_engine.sql"),
  security:await read("supabase/migrations/202607280700_aora_pilot_security_and_qa_redaction.sql"),ciMigration:await read("supabase/migrations/202607280800_aora_ci_oidc_tenant_bootstrap.sql"),
  realtimeMigration:await read("supabase/migrations/202607280900_aora_realtime_rest_bridge.sql"),cleanupMigration:await read("supabase/migrations/202607280910_aora_ci_ledger_cleanup_exception.sql"),
  ciBootstrap:await read("supabase/functions/aora-v8-pilot-ci-bootstrap/index.ts"),realtimeBroadcast:await read("supabase/functions/aora-v8-pilot-realtime-broadcast/index.ts"),
  pilotMonitor:await read("supabase/functions/aora-v8-pilot-monitor/index.ts"),complianceProxy:await read("supabase/functions/aora-v8-pilot-compliance-proxy/index.ts"),pilotOnboarding:await read("supabase/functions/aora-v8-pilot-onboarding/index.ts"),
  ciWorkflow:await read("../.github/workflows/aora-v8-pilot-ci.yml"),e2e:await read("tests/aora-four-role.spec.mjs"),
  pilotAccess:await read("supabase/functions/aora-v8-pilot-access/index.ts"),pilotWorkspace:await read("supabase/functions/aora-v8-pilot-workspace/index.ts"),pilotKiosk:await read("supabase/functions/aora-v8-pilot-kiosk/index.ts"),ruleGate:await read("supabase/functions/aora-v8-pilot-workspace-rules/index.ts"),
  employee:await read("overlay/modules/employee-hardening.js"),identity:await read("overlay/modules/identity-hardening.js"),profile:await read("overlay/modules/profile-hardening.js"),
  canonicalKiosk:await read("../aora/modules/kiosk-view.js"),baseCss:await read("../aora/styles.css"),overlayCss:await read("overlay/styles.css"),build:await read("build.mjs")
};
const requireAll=(name,text,markers)=>{for(const marker of markers)if(!text.includes(marker))throw new Error(`Missing ${name} marker: ${marker}`)};
const forbidAll=(name,text,markers)=>{for(const marker of markers)if(text.includes(marker))throw new Error(`Forbidden ${name} marker: ${marker}`)};

requireAll("index",source.index,["offline.css?v=810","rule-engine.css?v=810","compliance.css?v=814","@supabase/supabase-js@2.57.4","modules/config.js?v=814","modules/realtime.js?v=814","modules/runtime-hardening.js?v=815","modules/monitoring.js?v=813","modules/compliance.js?v=813"]);
requireAll("config",source.config,['DEFAULT_WORKSPACE_SLUG="aora-demo"','publishableKey:"sb_publishable_','complianceFunction:"aora-v8-pilot-compliance"','monitorFunction:"aora-v8-pilot-monitor"','realtimeBroadcastFunction:"aora-v8-pilot-realtime-broadcast"','realtimeFallbackMs:60000','version:"8.1.0-pilot"']);
const configured=source.config.match(/version:\s*"([^"]+)"/)?.[1];
if(configured!==pkg.version)throw new Error(`Version mismatch: ${configured} vs ${pkg.version}`);
requireAll("tenant isolation",source.tenant,["manager_location_access","members read scoped locations","members read scoped employees","manager_can_access_location"]);
requireAll("dynamic access",source.pilotAccess,["workspaceSlug(body","new globalThis.URL(origin)","aora_activate_invitation_atomic","passwordLogin","inspectInvitation","organizationSlug"]);
requireAll("breached-password protection",source.pilotAccess,["assertPasswordNotPwned","api.pwnedpasswords.com/range",'"Add-Padding": "true"','"SHA-1"',"hash.slice(0, 5)","hash.slice(5)","await assertPasswordNotPwned(password)"]);
forbidAll("dynamic access",source.pilotAccess,['const WORKSPACE="aora-v8-hardening-demo"','const URL = Deno.env.get("SUPABASE_URL")','new URL(origin)','`${PWNED_PASSWORDS_RANGE_URL}/${hash}`']);
requireAll("tenant workspace",source.pilotWorkspace,['tenantSource: "session"','eq("id", session.organization_id)',"Kein Zugriff auf diesen Standort.","state.kioskDevices.find"]);
forbidAll("tenant workspace",source.pilotWorkspace,['.eq("slug", PRIMARY_PILOT_SLUG)']);
requireAll("punch receipts",source.punch,["public.punch_events","primary key (organization_id, event_id)","aora_begin_punch","aora_claim_punch_approval","approval_response_payload"]);
requireAll("pilot kiosk",source.pilotKiosk,["aora_begin_punch","clientEventId","clock_${eventId}","x-aora-punch-replay","idempotentReplay"]);
requireAll("punch client",source.api,["preparePunchEvent","crypto.randomUUID()","enqueueOfflinePunch","markOfflinePunchPending","resolveOfflinePunch","idempotentReplay","text/plain;charset=UTF-8"]);
requireAll("offline queue",source.offline,["indexedDB.open","offline_punch_queue","device_keys","device_sessions",'name:"AES-GCM"',"extractable:false","ciphertext","additionalData","inspectOfflineQueue","serviceWorker.register"]);
forbidAll("offline queue",source.offline,["localStorage.setItem","payload:event","employeeId:event.employeeId","transition:event.target"]);
requireAll("service worker",source.sw,["aora-punch-sync","offline_punch_queue","device_keys","device_sessions","aora-v8-pilot-kiosk","AORA_PUNCH_SYNCED","text/plain;charset=UTF-8"]);
requireAll("rule schema",source.rules,["work_rule_sets","work_rules","work_rule_evaluations","aora_evaluate_shift_rules","SHIFT_OVERLAP","MIN_REST_BETWEEN_SHIFTS","DST_TRANSITION","rule_set_version"]);
requireAll("rule gate",source.ruleGate,["SHIFT_EVENTS","evaluateShift","aora_evaluate_shift_rules","Bestätigung und Begründung erforderlich.","ruleSetVersion","ruleEvaluationId"]);
requireAll("rule UI",source.ruleUi,["Backend-Prüfung aktiv","evaluateShift","shiftRuleDialog","Ausnahme mit Begründung","Arbeitszeitregeln","Regelset Version"]);
requireAll("realtime client",source.realtime,["workspace-change","aoraSha256Hex","realtimeFallbackMs","SUBSCRIBED","connectWorkspaceRealtime","disconnectWorkspaceRealtime","__aoraLastRealtimeEvent"]);
requireAll("runtime tenant and broadcast routing",source.runtime,["workspaceSlug:CFG.slug","downloadCompliance","connectWorkspaceRealtime","disconnectWorkspaceRealtime","notifyWorkspaceRealtime","realtimeBroadcastFunction","text/plain;charset=UTF-8",'AORA_COMPLIANCE_FUNCTION="aora-v8-pilot-compliance-proxy"']);
requireAll("Realtime REST bridge",source.realtimeMigration,["drop trigger if exists aora_workspace_revision_broadcast","aora_active_session_topics"].filter(marker=>source.realtimeMigration.includes(marker)));
requireAll("origin-safe Realtime broadcaster",source.realtimeBroadcast,["validate_demo_session","aora_active_session_topics","/realtime/v1/api/broadcast","workspace-change","deliveredTopics","new globalThis.URL(origin)","SUPABASE_URL"]);
forbidAll("origin-safe Realtime broadcaster",source.realtimeBroadcast,['const URL=Deno.env.get("SUPABASE_URL")','new URL(origin)']);
requireAll("origin-safe monitor",source.pilotMonitor,["new globalThis.URL(origin)","aora_consume_rate_limit","pilot_error_events","Access-Control-Allow-Private-Network"]);
forbidAll("origin-safe monitor",source.pilotMonitor,['const URL=Deno.env.get("SUPABASE_URL")','new URL(origin)']);
requireAll("compliance proxy",source.complianceProxy,["aora-v8-pilot-compliance","new globalThis.URL(origin)","content-disposition","x-aora-export-checksum","SERVICE_KEY"]);
forbidAll("compliance proxy",source.complianceProxy,["SUPABASE_SERVICE_ROLE_KEY\")!;\nconst service"]);
requireAll("origin-safe onboarding",source.pilotOnboarding,["aora_provision_pilot_organization","new globalThis.URL(origin)","crypto.getRandomValues","managerInvitation","kioskActivation","Access-Control-Allow-Private-Network"]);
forbidAll("origin-safe onboarding",source.pilotOnboarding,['const URL=Deno.env.get("SUPABASE_URL")','new URL(origin)','Math.random']);
requireAll("scoped CI ledger cleanup",source.cleanupMigration,["aora.cleanup_organization_id","tenantSource","github-oidc-ci","aora_cleanup_ci_tenant"]);
requireAll("monitoring",source.monitoring,["AORA_SECRET_PATTERN","[REDACTED]","unhandledrejection","reportClientDiagnostic"]);
requireAll("compliance UI",source.compliance,["Compliance & Korrekturen","requestCorrection","decideCorrection","downloadCompliance","Verifiziertes Snapshot"]);
requireAll("mobile correction action",source.complianceCss,["employee-correction-fab","bottom:calc(81px + env(safe-area-inset-bottom,0px))","z-index:60"]);
requireAll("kiosk manager feedback",source.handlers,["TOGGLE_KIOSK_LOCK","Kiosk-Gerät wurde gesperrt.","Kiosk-Gerät konnte nicht aktualisiert werden."]);
forbidAll("legacy polling",source.boot,["setInterval(refreshWorkspace,5000)"]);
requireAll("security migration",source.security,["revoke all on function public.aora_activate_invitation_atomic","aora_redact_pilot_qa_evidence","[REDACTED]","grant execute on function public.aora_verify_time_entry_chain"]);
requireAll("OIDC CI bootstrap",source.ciBootstrap,["token.actions.githubusercontent.com","aora-staging-ci",'REPOSITORY_ID="1044549733"','ALLOWED_HEAD="agent/aora-v8-hardening"','ALLOWED_BASE="agent/aora-v8-final"',"aora_bootstrap_ci_tenant","aora_cleanup_ci_tenant"]);
requireAll("OIDC CI migration",source.ciMigration,["aora_bootstrap_ci_tenant","aora_cleanup_ci_tenant","github-oidc-ci","grant execute on function public.aora_bootstrap_ci_tenant"]);
requireAll("OIDC workflow",source.ciWorkflow,["id-token: write","ACTIONS_ID_TOKEN_REQUEST_URL","audience=aora-staging-ci","::add-mask::","Cleanup isolated staging tenant","AORA_INVITATION_URL","playwright-report.json"]);
forbidAll("stored CI secrets",source.ciWorkflow,["secrets.AORA_OWNER","secrets.AORA_MANAGER","secrets.AORA_EMPLOYEE","secrets.AORA_KIOSK","secrets.AORA_ONBOARDING"]);
requireAll("expanded browser E2E",source.e2e,["every navigation view","exports and verified backup","all scoped views","every tab","submit and approve leave plus time correction","encrypted offline queue","Invitation: reject breached password","assertNoHorizontalOverflow","triggerAccessRejection","Password123!","AORA_INVITATION_URL"]);
forbidAll("employee identity",source.employee,["S.state.employees?.[0]","S.state.employees[0]"]);
forbidAll("admin identity",source.identity,["admins?.[0]","admins[0]"]);
forbidAll("profile identity",source.profile,["employees?.[0]","employees[0]"]);
if(source.canonicalKiosk.includes("aora-v8-hardening"))throw new Error("Canonical aora kiosk was modified");
requireAll("canonical style",source.baseCss,["--black:#000","--white:#fff","--radius:16px",".aora-logo"]);
for(const selector of [/(^|})\s*:root\s*{/m,/(^|})\s*body\s*[{,]/m,/(^|})\s*\.aora-logo\s*{/m])if(selector.test(source.overlayCss))throw new Error(`Overlay replaces canonical selector: ${selector}`);
if(!source.build.includes('`${originalCss}\\n\\n${extensionCss}\\n`'))throw new Error("Canonical CSS append order changed");
console.log(`Aora 8.1.0 pilot gate passed (${modules.length} overlay modules): dynamic access and breached-password protection, tenant isolation, OIDC-isolated CI, origin-safe Realtime REST broadcast, mobile correction action, compliance bridge and onboarding, durable punch integrity, encrypted offline queue and versioned work rules.`);
