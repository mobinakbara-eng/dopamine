import { execFileSync } from "node:child_process";
import { access, readdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root=dirname(fileURLToPath(import.meta.url));
const moduleDir=resolve(root,"app/modules");
const modules=(await readdir(moduleDir)).filter(file=>file.endsWith(".js")).sort();
const requiredModules=[
  "access.js","admin-metrics-hardening.js","api.js","boot.js","compliance.js","config.js","date-hardening.js",
  "employee-hardening.js","handlers.js","identity-hardening.js","invitation-delivery.js","kiosk-hardening.js",
  "monitoring.js","offline-punch.js","owner-routing.js","profile-hardening.js","realtime.js","rule-engine.js","runtime-hardening.js"
];
for(const required of requiredModules){if(!modules.includes(required))throw new Error(`Missing required app module: ${required}`)}
for(const file of modules)execFileSync(process.execPath,["--check",resolve(moduleDir,file)],{stdio:"inherit"});
const pkg=JSON.parse(await readFile(resolve(root,"package.json"),"utf8"));
JSON.parse(await readFile(resolve(root,"vercel.json"),"utf8"));

const paths=[
  "app/index.html","app/styles.base.css","app/styles.css","app/offline.css","app/rule-engine.css","app/compliance.css","app/sw.js",
  "app/modules/config.js","app/modules/api.js","app/modules/offline-punch.js","app/modules/rule-engine.js",
  "app/modules/realtime.js","app/modules/runtime-hardening.js","app/modules/accessibility-hardening.js","app/modules/monitoring.js","app/modules/compliance.js","app/modules/handlers.js",
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
  "supabase/migrations/202607281000_aora_unified_login_projection_sessions.sql",
  "supabase/migrations/202607281100_aora_production_fk_indexes.sql",
  "supabase/migrations/202607281200_aora_manager_projection_durability.sql",
  "supabase/migrations/202607281300_aora_single_projection_commit.sql",
  "supabase/migrations/202607291000_aora_manager_kiosk_activation.sql",
  "supabase/migrations/20260729004408_fix_geofence_and_time_duration_consistency.sql",
  "tests/offline-crypto.mjs","tests/environment-guard.mjs","tests/aora-four-role.spec.mjs","playwright.config.mjs","../.github/workflows/aora-v8-pilot-ci.yml"
];
for(const path of paths)await access(resolve(root,path)).catch(()=>{throw new Error(`Missing pilot source: ${path}`)});
const read=path=>readFile(resolve(root,path),"utf8");
const source={
  index:await read("app/index.html"),config:await read("app/modules/config.js"),api:await read("app/modules/api.js"),
  offline:await read("app/modules/offline-punch.js"),ruleUi:await read("app/modules/rule-engine.js"),sw:await read("app/sw.js"),
  realtime:await read("app/modules/realtime.js"),runtime:await read("app/modules/runtime-hardening.js"),accessibility:await read("app/modules/accessibility-hardening.js"),monitoring:await read("app/modules/monitoring.js"),compliance:await read("app/modules/compliance.js"),handlers:await read("app/modules/handlers.js"),complianceCss:await read("app/compliance.css"),boot:await read("app/modules/boot.js"),
  tenant:await read("supabase/migrations/202607280011_aora_pilot_tenant_location_isolation.sql"),punch:await read("supabase/migrations/202607280012_aora_pilot_punch_idempotency.sql"),rules:await read("supabase/migrations/202607280013_aora_pilot_work_rule_engine.sql"),
  security:await read("supabase/migrations/202607280700_aora_pilot_security_and_qa_redaction.sql"),ciMigration:await read("supabase/migrations/202607280800_aora_ci_oidc_tenant_bootstrap.sql"),
  realtimeMigration:await read("supabase/migrations/202607280900_aora_realtime_rest_bridge.sql"),cleanupMigration:await read("supabase/migrations/202607280910_aora_ci_ledger_cleanup_exception.sql"),
  unifiedMigration:await read("supabase/migrations/202607281000_aora_unified_login_projection_sessions.sql"),productionIndexes:await read("supabase/migrations/202607281100_aora_production_fk_indexes.sql"),managerProjection:await read("supabase/migrations/202607281200_aora_manager_projection_durability.sql"),singleProjectionCommit:await read("supabase/migrations/202607281300_aora_single_projection_commit.sql"),kioskActivationMigration:await read("supabase/migrations/202607291000_aora_manager_kiosk_activation.sql"),geofenceDurationMigration:await read("supabase/migrations/20260729004408_fix_geofence_and_time_duration_consistency.sql"),
  ciBootstrap:await read("supabase/functions/aora-v8-pilot-ci-bootstrap/index.ts"),realtimeBroadcast:await read("supabase/functions/aora-v8-pilot-realtime-broadcast/index.ts"),
  pilotMonitor:await read("supabase/functions/aora-v8-pilot-monitor/index.ts"),complianceProxy:await read("supabase/functions/aora-v8-pilot-compliance-proxy/index.ts"),pilotOnboarding:await read("supabase/functions/aora-v8-pilot-onboarding/index.ts"),
  ciWorkflow:await read("../.github/workflows/aora-v8-pilot-ci.yml"),e2e:await read("tests/aora-four-role.spec.mjs"),
  pilotAccess:await read("supabase/functions/aora-v8-pilot-access/index.ts"),pilotWorkspace:await read("supabase/functions/aora-v8-pilot-workspace/index.ts"),hardeningWorkspace:await read("supabase/functions/aora-v8-hardening-workspace/index.ts"),pilotKiosk:await read("supabase/functions/aora-v8-pilot-kiosk/index.ts"),ruleGate:await read("supabase/functions/aora-v8-pilot-workspace-rules/index.ts"),
  employee:await read("app/modules/employee-hardening.js"),identity:await read("app/modules/identity-hardening.js"),profile:await read("app/modules/profile-hardening.js"),admin:await read("app/modules/admin.js"),modals:await read("app/modules/modals.js"),
  canonicalKiosk:await read("app/modules/kiosk-view.js"),baseCss:await read("app/styles.base.css"),overlayCss:await read("app/styles.css"),build:await read("build.mjs")
};
const requireAll=(name,text,markers)=>{for(const marker of markers)if(!text.includes(marker))throw new Error(`Missing ${name} marker: ${marker}`)};
const forbidAll=(name,text,markers)=>{for(const marker of markers)if(text.includes(marker))throw new Error(`Forbidden ${name} marker: ${marker}`)};

requireAll("index",source.index,["styles.base.css?v=804","styles.css?v=819","runtime-config.js","offline.css?v=810","rule-engine.css?v=810","compliance.css?v=814","@supabase/supabase-js@2.57.4","modules/config.js?v=821","modules/realtime.js?v=814","modules/runtime-hardening.js?v=818","modules/accessibility-hardening.js?v=817","modules/monitoring.js?v=813","modules/compliance.js?v=813","modules/offline-punch.js?v=818","modules/api.js?v=820","modules/unified-login.js?v=819","modules/employee-hardening.js?v=819","modules/modals.js?v=819","modules/invitation-delivery.js?v=819","modules/handlers.js?v=822","modules/boot.js?v=821"]);
requireAll("config",source.config,['DEFAULT_WORKSPACE_SLUG="aora-demo"',"window.__AORA_RUNTIME_CONFIG__","RUNTIME.supabaseUrl","RUNTIME.supabasePublishableKey",'RUNTIME_FUNCTIONS.access','RUNTIME_FUNCTIONS.workspace','RUNTIME_FUNCTIONS.kiosk','realtimeFallbackMs:60000','version:"8.1.0-pilot"']);
const configured=source.config.match(/version:\s*"([^"]+)"/)?.[1];
if(configured!==pkg.version)throw new Error(`Version mismatch: ${configured} vs ${pkg.version}`);
requireAll("tenant isolation",source.tenant,["manager_location_access","members read scoped locations","members read scoped employees","manager_can_access_location"]);
requireAll("dynamic access",source.pilotAccess,["workspaceSlug(body","new globalThis.URL(origin)","aora_activate_invitation_atomic","passwordLogin","inspectInvitation","organizationSlug"]);
requireAll("single-request login",source.pilotAccess,['consumeRateLimit(request, slug, "password", email)','account && account.record.status === "active"']);
forbidAll("single-request login",source.pilotAccess,['`${accessRole}:${email}`','account.accessRole === accessRole']);
requireAll("breached-password protection",source.pilotAccess,["assertPasswordNotPwned","api.pwnedpasswords.com/range",'"Add-Padding": "true"','"SHA-1"',"hash.slice(0, 5)","hash.slice(5)","await assertPasswordNotPwned(password)"]);
forbidAll("dynamic access",source.pilotAccess,['const WORKSPACE="aora-v8-hardening-demo"','const URL = Deno.env.get("SUPABASE_URL")','new URL(origin)','`${PWNED_PASSWORDS_RANGE_URL}/${hash}`']);
requireAll("tenant workspace",source.pilotWorkspace,['tenantSource: "session"','eq("id", session.organization_id)',"Kein Zugriff auf diesen Standort.","state.kioskDevices.find"]);
forbidAll("tenant workspace",source.pilotWorkspace,['.eq("slug", PRIMARY_PILOT_SLUG)']);
requireAll("server geofence enforcement",source.pilotWorkspace,["configuredLocationPosition","enforceApprovalGeofence","Math.abs(Date.now() - capturedAt) > 120_000","Ausserhalb des Standorts","maxGpsAccuracy"]);
requireAll("geolocation timestamp fallback",source.handlers,["Number(position.timestamp)","Number.isFinite(timestamp)&&timestamp>0?timestamp:Date.now()"]);
requireAll("location GPS persistence",source.hardeningWorkspace,["locationGps(input)","gpsConfigured: true","latitude,","longitude,"]);
requireAll("canonical public links",source.hardeningWorkspace,['CANONICAL_APP_ORIGIN = "https://dopamine-mobins-projects-4f428afa.vercel.app"',"function publicAppOrigin","const appOrigin = publicAppOrigin(origin)"]);
requireAll("canonical onboarding links",source.pilotOnboarding,['const APP_URL = "https://dopamine-mobins-projects-4f428afa.vercel.app"']);
requireAll("duration correction consistency",source.geofenceDurationMigration,["aora_recalculate_time_entry_duration","durationMinutes","aora_decide_time_correction_atomic","aora_commit_workspace_state"]);
requireAll("punch receipts",source.punch,["public.punch_events","primary key (organization_id, event_id)","aora_begin_punch","aora_claim_punch_approval","approval_response_payload"]);
requireAll("pilot kiosk",source.pilotKiosk,["aora_begin_punch","clientEventId","clock_${eventId}","x-aora-punch-replay","idempotentReplay"]);
requireAll("punch client",source.api,["preparePunchEvent","crypto.randomUUID()","enqueueOfflinePunch","markOfflinePunchPending","resolveOfflinePunch","idempotentReplay","text/plain;charset=UTF-8"]);
requireAll("stale session response guard",source.api,["requestedSessionToken","String(S.session?.token||\"\")!==requestedSessionToken"]);
requireAll("canonical invitation redirect",source.boot,["redirectInvitationToCanonicalOrigin","location.hostname.endsWith(\".vercel.app\")","location.replace(target.toString())"]);
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
requireAll("manager projection and session lifecycle",source.unifiedMigration,["aora_sync_manager_location_access","aora_project_snapshot_trigger","aora_trim_subject_sessions","aora_cleanup_expired_sessions","manager-session-projection-cleanup"]);
requireAll("production foreign-key indexes",source.productionIndexes,["billing_events_organization_id_idx","compliance_exports_organization_id_idx","data_export_requests_organization_id_idx","deletion_requests_organization_id_idx","pilot_backups_organization_id_idx","subprocessors_organization_id_idx","work_rules_organization_id_idx"]);
requireAll("durable manager projection",source.managerProjection,["not exists (","access_row.manager_id","access_row.location_id","on conflict(organization_id,manager_id,location_id) do update"]);
requireAll("single-pass workspace commit",source.singleProjectionCommit,["create or replace function public.aora_commit_workspace_state","update public.workspace_snapshots","aora_record_workspace_event"]);
forbidAll("single-pass workspace commit",source.singleProjectionCommit,["project_workspace_state"]);
requireAll("structural action routing",source.pilotWorkspace,["STRUCTURAL_TYPES.has(body.event?.type)","HARDENING_WORKSPACE","CREATE_EMPLOYEE_ACCOUNT","INVITE_MANAGER","TOGGLE_KIOSK_LOCK"]);
requireAll("legacy manager projection repair",source.pilotWorkspace,["aora_sync_manager_location_access","managerProjectionError","legacy.data?.state"]);
requireAll("strict manager projection",source.hardeningWorkspace,["manager_location_access","managerLocationIds","kein expliziter Standortzugriff"]);
forbidAll("strict manager projection",source.hardeningWorkspace,['.eq("slug", WORKSPACE_SLUG)',"ctx.admin.locationIds"]);
forbidAll("pilot manager fallback",source.pilotWorkspace,["admin?.locationIds"]);
forbidAll("rule manager fallback",source.ruleGate,["admin.locationIds"]);
requireAll("monitoring",source.monitoring,["AORA_SECRET_PATTERN","[REDACTED]","unhandledrejection","reportClientDiagnostic"]);
requireAll("runtime accessibility",source.accessibility,["label.htmlFor=control.id",'setAttribute("role","dialog")','setAttribute("aria-modal","true")',"MutationObserver","aoraHardenAccessibility"]);
requireAll("reduced motion and focus",source.overlayCss,["*:focus-visible","prefers-reduced-motion:reduce","animation-duration:.01ms"]);
requireAll("compliance UI",source.compliance,["Compliance & Korrekturen","requestCorrection","decideCorrection","downloadCompliance","Verifiziertes Snapshot"]);
requireAll("mobile correction action",source.complianceCss,["employee-correction-fab","bottom:calc(81px + env(safe-area-inset-bottom,0px))","z-index:60"]);
requireAll("kiosk manager feedback",source.handlers,["TOGGLE_KIOSK_LOCK","Kiosk-Gerät wurde gesperrt.","Kiosk-Gerät konnte nicht aktualisiert werden."]);
requireAll("deterministic kiosk lock",source.handlers,["locked:locking","const locking=!Boolean(device.locked)"]);
requireAll("atomic kiosk lock",source.hardeningWorkspace,['case "TOGGLE_KIOSK_LOCK"','typeof event.locked !== "boolean"',"kiosk.locked","kiosk.unlocked"]);
requireAll("workspace-bound invitation",source.hardeningWorkspace,['inviteUrl.searchParams.set("workspace", ctx.organization.slug)','inviteUrl.toString()']);
requireAll("manager kiosk creation",source.hardeningWorkspace,['case "CREATE_KIOSK_DEVICE"','case "ROTATE_KIOSK_ACTIVATION"',"aora_commit_kiosk_activation","activationCode()","kioskActivation"]);
requireAll("atomic kiosk activation migration",source.kioskActivationMigration,["create or replace function public.aora_commit_kiosk_activation","crypt(p_activation_code, gen_salt('bf'))","update public.app_sessions","revoke all on function public.aora_commit_kiosk_activation","to service_role"]);
requireAll("manager kiosk UI",source.admin,['data-a="kiosk-create-modal"','data-a="rotate-kiosk"',"Noch kein Kiosk-Gerät vorhanden"]);
requireAll("kiosk activation modal",source.modals,["kioskCreateModal","kioskActivationResultModal","Zugangsdaten kopieren","CREATE_KIOSK_DEVICE"]);
requireAll("accessible modal lifecycle",source.modals,['role="dialog"','aria-modal="true"','event.key==="Escape"','previousFocus','document.removeEventListener("keydown",onKeydown,true)']);
requireAll("durable kiosk session restore",source.offline,["restoreOfflineKioskSession","OFFLINE_SESSION_STORE","decryptJson"]);
requireAll("kiosk and invitation E2E",source.e2e,["CREATE_KIOSK_DEVICE","kioskActivation.activationCode",'searchParams.get("workspace")',"inside/outside geofence enforcement","durationMinutes:505"]);
forbidAll("single snapshot projection",source.hardeningWorkspace,['service.rpc("project_workspace_state"']);
requireAll("render after action unlock",source.api,["clearPendingPunch(prepared.storageKey);\n    S.busy=false;\n    render();"]);
forbidAll("legacy polling",source.boot,["setInterval(refreshWorkspace,5000)"]);
requireAll("security migration",source.security,["revoke all on function public.aora_activate_invitation_atomic","aora_redact_pilot_qa_evidence","[REDACTED]","grant execute on function public.aora_verify_time_entry_chain"]);
requireAll("OIDC CI bootstrap",source.ciBootstrap,["token.actions.githubusercontent.com","aora-staging-ci","agent/aora-unified-production","agent/aora-relational-foundation","agent/aora-access-hardening","agent/aora-workforce-features",'ALLOWED_BASES=new Set(["agent/aora-v8-final","main"])',"aora_bootstrap_ci_tenant","aora_cleanup_ci_tenant"]);
requireAll("OIDC CI migration",source.ciMigration,["aora_bootstrap_ci_tenant","aora_cleanup_ci_tenant","github-oidc-ci","grant execute on function public.aora_bootstrap_ci_tenant"]);
requireAll("OIDC workflow",source.ciWorkflow,["id-token: write","ACTIONS_ID_TOKEN_REQUEST_URL","audience=aora-staging-ci","::add-mask::","Cleanup isolated staging tenant","AORA_INVITATION_URL","playwright-report.json"]);
forbidAll("stored CI secrets",source.ciWorkflow,["secrets.AORA_OWNER","secrets.AORA_MANAGER","secrets.AORA_EMPLOYEE","secrets.AORA_KIOSK","secrets.AORA_ONBOARDING"]);
requireAll("expanded browser E2E",source.e2e,["every navigation view","exports and verified backup","all scoped views","every tab","submit and approve leave plus time correction","encrypted offline queue","Invitation: reject breached password","assertNoHorizontalOverflow","triggerAccessRejection","Password123!","AORA_INVITATION_URL"]);
forbidAll("employee identity",source.employee,["S.state.employees?.[0]","S.state.employees[0]"]);
forbidAll("admin identity",source.identity,["admins?.[0]","admins[0]"]);
forbidAll("profile identity",source.profile,["employees?.[0]","employees[0]"]);
if(source.canonicalKiosk.includes("aora-v8-hardening"))throw new Error("Canonical kiosk source was modified");
requireAll("canonical style",source.baseCss,["--black:#000","--white:#fff","--radius:16px",".aora-logo"]);
for(const selector of [/(^|})\s*:root\s*{/m,/(^|})\s*body\s*[{,]/m,/(^|})\s*\.aora-logo\s*{/m])if(selector.test(source.overlayCss))throw new Error(`Overlay replaces canonical selector: ${selector}`);
requireAll("canonical build",source.build,[
  'const source = resolve(root, "app")',
  'Production build blocked: Supabase staging project ref is configured.',
  'AORA_SUPABASE_URL and AORA_SUPABASE_PUBLISHABLE_KEY are required for production builds.',
  'window.__AORA_RUNTIME_CONFIG__=Object.freeze'
]);
for(const legacyPath of ['resolve(root, "../aora")','resolve(root, "overlay")'])if(source.build.includes(legacyPath))throw new Error(`Legacy build source remains: ${legacyPath}`);
console.log(`Aora 8.1.0 canonical gate passed (${modules.length} app modules): one source tree, environment isolation, dynamic access and breached-password protection, tenant isolation, OIDC-isolated CI, origin-safe Realtime REST broadcast, durable punch integrity, encrypted offline queue and versioned work rules.`);

