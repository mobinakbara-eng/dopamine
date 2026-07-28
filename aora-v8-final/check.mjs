import { execFileSync } from "node:child_process";
import { access, readdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root=dirname(fileURLToPath(import.meta.url));
const modules=resolve(root,"overlay/modules");
const moduleFiles=(await readdir(modules)).filter(file=>file.endsWith(".js")).sort();
if(!moduleFiles.length)throw new Error("No overlay JavaScript modules found.");
for(const file of moduleFiles)execFileSync(process.execPath,["--check",resolve(modules,file)],{stdio:"inherit"});

const packageJson=JSON.parse(await readFile(resolve(root,"package.json"),"utf8"));
JSON.parse(await readFile(resolve(root,"vercel.json"),"utf8"));
const requiredPaths=[
  "supabase/functions/aora-v8-hardening-access/index.ts",
  "supabase/functions/aora-v8-hardening-workspace/index.ts",
  "supabase/functions/aora-v8-hardening-kiosk/index.ts",
  "supabase/functions/aora-v8-pilot-workspace/index.ts",
  "supabase/functions/aora-v8-pilot-kiosk/index.ts",
  "supabase/migrations/202607270001_aora_hardening_atomic_rate_limit.sql",
  "supabase/migrations/202607270002_aora_hardening_atomic_invitation_accept.sql",
  "supabase/migrations/202607270003_aora_hardening_atomic_projection_trigger.sql",
  "supabase/migrations/202607270004_reject_locked_kiosk_login.sql",
  "supabase/migrations/202607270005_disable_hardening_owner_pin.sql",
  "supabase/migrations/202607270006_one_open_time_entry_per_employee.sql",
  "supabase/migrations/202607280011_aora_pilot_tenant_location_isolation.sql",
  "supabase/migrations/202607280012_aora_pilot_punch_idempotency.sql",
];
for(const relativePath of requiredPaths)await access(resolve(root,relativePath)).catch(()=>{throw new Error(`Missing pilot source: ${relativePath}`)});

const sources={
  index:await readFile(resolve(root,"overlay/index.html"),"utf8"),
  config:await readFile(resolve(modules,"config.js"),"utf8"),
  api:await readFile(resolve(modules,"api.js"),"utf8"),
  access:await readFile(resolve(modules,"access.js"),"utf8"),
  boot:await readFile(resolve(modules,"boot.js"),"utf8"),
  handlers:await readFile(resolve(modules,"handlers.js"),"utf8"),
  invitation:await readFile(resolve(modules,"invitation-delivery.js"),"utf8"),
  date:await readFile(resolve(modules,"date-hardening.js"),"utf8"),
  employee:await readFile(resolve(modules,"employee-hardening.js"),"utf8"),
  identity:await readFile(resolve(modules,"identity-hardening.js"),"utf8"),
  profile:await readFile(resolve(modules,"profile-hardening.js"),"utf8"),
  adminMetrics:await readFile(resolve(modules,"admin-metrics-hardening.js"),"utf8"),
  kiosk:await readFile(resolve(modules,"kiosk-hardening.js"),"utf8"),
  accessFunction:await readFile(resolve(root,"supabase/functions/aora-v8-hardening-access/index.ts"),"utf8"),
  hardeningWorkspace:await readFile(resolve(root,"supabase/functions/aora-v8-hardening-workspace/index.ts"),"utf8"),
  hardeningKiosk:await readFile(resolve(root,"supabase/functions/aora-v8-hardening-kiosk/index.ts"),"utf8"),
  pilotWorkspace:await readFile(resolve(root,"supabase/functions/aora-v8-pilot-workspace/index.ts"),"utf8"),
  pilotKiosk:await readFile(resolve(root,"supabase/functions/aora-v8-pilot-kiosk/index.ts"),"utf8"),
  tenantMigration:await readFile(resolve(root,"supabase/migrations/202607280011_aora_pilot_tenant_location_isolation.sql"),"utf8"),
  punchMigration:await readFile(resolve(root,"supabase/migrations/202607280012_aora_pilot_punch_idempotency.sql"),"utf8"),
  projectionMigration:await readFile(resolve(root,"supabase/migrations/202607270003_aora_hardening_atomic_projection_trigger.sql"),"utf8"),
  kioskLoginMigration:await readFile(resolve(root,"supabase/migrations/202607270004_reject_locked_kiosk_login.sql"),"utf8"),
  ownerPinMigration:await readFile(resolve(root,"supabase/migrations/202607270005_disable_hardening_owner_pin.sql"),"utf8"),
  openEntryMigration:await readFile(resolve(root,"supabase/migrations/202607270006_one_open_time_entry_per_employee.sql"),"utf8"),
  canonicalKiosk:await readFile(resolve(root,"../aora/modules/kiosk-view.js"),"utf8"),
  baseCss:await readFile(resolve(root,"../aora/styles.css"),"utf8"),
  overlayCss:await readFile(resolve(root,"overlay/styles.css"),"utf8"),
  build:await readFile(resolve(root,"build.mjs"),"utf8"),
};
function requireMarkers(name,source,markers){for(const marker of markers)if(!source.includes(marker))throw new Error(`Missing ${name} marker: ${marker}`)}
function forbidMarkers(name,source,markers){for(const marker of markers)if(source.includes(marker))throw new Error(`Forbidden ${name} marker: ${marker}`)}

requireMarkers("index",sources.index,[
  "styles.css?v=809","invitation.css?v=809","modules/config.js?v=811","modules/api.js?v=810","modules/access.js?v=809",
  "modules/employee-hardening.js?v=809","modules/identity-hardening.js?v=809","modules/profile-hardening.js?v=809",
  "modules/handlers.js?v=809","modules/admin-metrics-hardening.js?v=808","modules/kiosk-hardening.js?v=808",
]);
requireMarkers("config",sources.config,[
  'slug:"aora-v8-hardening-demo"','accessFunction:"aora-v8-hardening-access"',
  'workspaceFunction:"aora-v8-pilot-workspace"','kioskWorkspaceFunction:"aora-v8-pilot-kiosk"','version:"8.1.0-pilot"',
]);
const configuredVersion=sources.config.match(/version:\s*"([^"]+)"/)?.[1];
if(configuredVersion!==packageJson.version)throw new Error(`Version mismatch: package.json=${packageJson.version}, config.js=${configuredVersion||"missing"}`);

requireMarkers("API",sources.api,[
  "REQUEST_TIMEOUT_MS","AbortController",'S.accessRole==="kiosk"?CFG.kioskWorkspaceFunction:CFG.workspaceFunction',
  "PUNCH_PENDING_TTL_MS","punchStorageKey","preparePunchEvent","crypto.randomUUID()","eventId","retryablePunchError",
  "Die Buchung wird bereits verarbeitet.","Diese Aktion wurde bereits gespeichert.",
]);
requireMarkers("access UI",sources.access,['const pinEnabled=role==="kiosk"','Inhaber, Arbeitgeber und Mitarbeiter melden sich ausschließlich','Der Aktivierungscode gilt nur für das lokale Kiosk-Gerät']);
forbidMarkers("access UI",sources.access,['role==="owner"||role==="kiosk"','PIN-Zugang bleibt nur für Inhaber']);
requireMarkers("boot",sources.boot,["await ensureDirectory(accessRole)","document.hidden","backgroundRefreshRunning"]);
requireMarkers("handlers",sources.handlers,["secureCurrentPosition","clock-approve","clock-deny","APPROVE_CLOCK_REQUEST","DENY_CLOCK_REQUEST","return-admin-role","Bitte erneut anmelden, um den Verwaltungsbereich zu öffnen."]);
requireMarkers("invitation",sources.invitation,["function managerInvitationModal()","function employeeInvitationModal()","submit.disabled=true","invitationDeliveryModal(result.delivery)"]);
requireMarkers("date overlay",sources.date,["isoDateValue","Date.UTC","getUTCDay","setUTCDate","timeZone:dateOnly?\"UTC\":CFG.tz"]);
requireMarkers("employee overlay",sources.employee,["employeeScopedState","activeEntryMinutes","pendingClockRequest","clockApprovalPanel","Das angemeldete Mitarbeiterkonto wurde nicht gefunden","clock-approve"]);
forbidMarkers("employee identity",sources.employee,["S.state.employees?.[0]","S.state.employees[0]","||S.state.employees"]);
requireMarkers("admin identity",sources.identity,["item.id===subjectId","item.status!==\"pending\"","item.status!==\"revoked\"","renderAdminCanonical","Bitte erneut anmelden"]);
forbidMarkers("admin identity",sources.identity,["admins?.[0]","admins[0]"]);
requireMarkers("profile identity",sources.profile,["item.id===employeeId","Das angemeldete Mitarbeiterkonto wurde nicht gefunden","UPDATE_PROFILE"]);
forbidMarkers("profile identity",sources.profile,["employees[0]","employees?.[0]"]);
requireMarkers("admin metrics",sources.adminMetrics,["function isActivatedAccount","status!==\"pending\"","Aktive Konten","Noch nicht aktiviert","function adminStats()"]);
requireMarkers("kiosk UI",sources.kiosk,['employee.status!=="pending"','employee.status!=="revoked"',"function renderKiosk()"]);
if(sources.canonicalKiosk.includes('status!=="pending"')||sources.canonicalKiosk.includes("aora-v8-hardening"))throw new Error("Canonical aora kiosk source was modified by the pilot layer.");

requireMarkers("access function",sources.accessFunction,["aora_consume_rate_limit","aora_accept_invitation_atomic","MAX_BODY_BYTES","Origin not allowed","TEAM_PREVIEW_SUFFIX"]);
requireMarkers("hardening workspace",sources.hardeningWorkspace,["timesheetPeriods: []",'event?.type !== "KIOSK_TRANSITION"','type: "REQUEST_CLOCK"',"MANAGER_LEGACY_TYPES","MAX_BODY_BYTES"]);
requireMarkers("hardening kiosk",sources.hardeningKiosk,['session.role !== "kiosk"','device.locked === true',"KIOSK_TARGETS","Dieser Statuswechsel ist aktuell nicht möglich."]);
requireMarkers("pilot workspace",sources.pilotWorkspace,[
  'tenantSource: "session"',"manager_location_access",'.eq("id", session.organization_id)',"aora_claim_punch_approval",
  "approval_response_payload","recoverApproval","aora_complete_punch_approval","idempotentReplay",
]);
forbidMarkers("pilot tenant context",sources.pilotWorkspace,['.eq("slug", PRIMARY_PILOT_SLUG)']);
requireMarkers("pilot kiosk",sources.pilotKiosk,[
  "aora_begin_punch","aora_complete_punch_request","clientEventId","clock_${eventId}","x-aora-punch-replay",
  "event_id ist erforderlich","punch_events","idempotentReplay","Paralleländerung erkannt",
]);
requireMarkers("tenant migration",sources.tenantMigration.toLowerCase(),[
  "manager_location_access","members read scoped locations","members read scoped employees","members read scoped time entries","manager_can_access_location","m.role::text in ('owner', 'admin')",
]);
requireMarkers("punch migration",sources.punchMigration.toLowerCase(),[
  "create table if not exists public.punch_events","primary key (organization_id, event_id)","aora_begin_punch","aora_complete_punch_request",
  "aora_claim_punch_approval","aora_complete_punch_approval","request_response_payload","approval_response_payload","service_role",
]);
requireMarkers("projection migration",sources.projectionMigration.toLowerCase(),["aora_hardening_project_snapshot_trigger","after update of state","project_workspace_state","service_role"]);
requireMarkers("kiosk login migration",sources.kioskLoginMigration,["organization.status='active'","device.locked=true","Dieses Kiosk-Gerät ist gesperrt oder deaktiviert.","service_role"]);
requireMarkers("owner PIN migration",sources.ownerPinMigration,["aora-v8-hardening-demo","identity.role='admin'","identity.subject_id='admin_1'","active=false"]);
requireMarkers("open entry migration",sources.openEntryMigration,["time_entries_one_open_per_employee","organization_id,employee_id","status in ('live','paused')","unique index"]);

requireMarkers("canonical visual identity",sources.baseCss,["--black:#000","--white:#fff","--radius:16px",'--font:"Manrope",Arial,sans-serif','--display:"Sora","Manrope",sans-serif',".aora-logo"]);
for(const forbidden of [/(^|})\s*:root\s*{/m,/(^|})\s*html\s*[{,]/m,/(^|})\s*body\s*[{,]/m,/(^|})\s*\*\s*{/m,/(^|})\s*\.aora-logo\s*{/m])if(forbidden.test(sources.overlayCss))throw new Error(`Overlay replaces canonical visual selector: ${forbidden}`);
if(!sources.build.includes('`${originalCss}\\n\\n${extensionCss}\\n`'))throw new Error("Build must preserve canonical CSS first and append the isolated overlay second.");

console.log(`Aora pilot checks passed (${moduleFiles.length} overlay modules, version ${configuredVersion}, tenant isolation and durable punch replay locked).`);