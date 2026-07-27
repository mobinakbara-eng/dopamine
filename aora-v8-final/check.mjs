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
  "supabase/migrations/202607270001_aora_hardening_atomic_rate_limit.sql",
  "supabase/migrations/202607270002_aora_hardening_atomic_invitation_accept.sql",
  "supabase/migrations/202607270003_aora_hardening_atomic_projection_trigger.sql",
  "supabase/migrations/202607270004_reject_locked_kiosk_login.sql",
];
for(const relativePath of requiredPaths){
  await access(resolve(root,relativePath)).catch(()=>{throw new Error(`Missing hardening source: ${relativePath}`)});
}

const sources={
  index:await readFile(resolve(root,"overlay/index.html"),"utf8"),
  config:await readFile(resolve(modules,"config.js"),"utf8"),
  api:await readFile(resolve(modules,"api.js"),"utf8"),
  boot:await readFile(resolve(modules,"boot.js"),"utf8"),
  handlers:await readFile(resolve(modules,"handlers.js"),"utf8"),
  invitation:await readFile(resolve(modules,"invitation-delivery.js"),"utf8"),
  date:await readFile(resolve(modules,"date-hardening.js"),"utf8"),
  employee:await readFile(resolve(modules,"employee-hardening.js"),"utf8"),
  adminMetrics:await readFile(resolve(modules,"admin-metrics-hardening.js"),"utf8"),
  kiosk:await readFile(resolve(modules,"kiosk-hardening.js"),"utf8"),
  accessFunction:await readFile(resolve(root,"supabase/functions/aora-v8-hardening-access/index.ts"),"utf8"),
  workspaceFunction:await readFile(resolve(root,"supabase/functions/aora-v8-hardening-workspace/index.ts"),"utf8"),
  kioskFunction:await readFile(resolve(root,"supabase/functions/aora-v8-hardening-kiosk/index.ts"),"utf8"),
  projectionMigration:await readFile(resolve(root,"supabase/migrations/202607270003_aora_hardening_atomic_projection_trigger.sql"),"utf8"),
  kioskLoginMigration:await readFile(resolve(root,"supabase/migrations/202607270004_reject_locked_kiosk_login.sql"),"utf8"),
  canonicalKiosk:await readFile(resolve(root,"../aora/modules/kiosk-view.js"),"utf8"),
  baseCss:await readFile(resolve(root,"../aora/styles.css"),"utf8"),
  overlayCss:await readFile(resolve(root,"overlay/styles.css"),"utf8"),
  build:await readFile(resolve(root,"build.mjs"),"utf8"),
};
function requireMarkers(name,source,markers){for(const marker of markers)if(!source.includes(marker))throw new Error(`Missing ${name} marker: ${marker}`)}

requireMarkers("index",sources.index,[
  "invitation.css?v=808","modules/config.js?v=808","modules/date-hardening.js?v=808",
  "modules/api.js?v=808","modules/employee-hardening.js?v=808","modules/admin-metrics-hardening.js?v=808",
  "modules/kiosk-hardening.js?v=808","modules/invitation-delivery.js?v=808","modules/handlers.js?v=808",
]);
requireMarkers("config",sources.config,[
  'slug:"aora-v8-hardening-demo"','accessFunction:"aora-v8-hardening-access"',
  'workspaceFunction:"aora-v8-hardening-workspace"','kioskWorkspaceFunction:"aora-v8-hardening-kiosk"',
  'version:"8.0.8-hardening"',
]);
const configuredVersion=sources.config.match(/version:\s*"([^"]+)"/)?.[1];
if(configuredVersion!==packageJson.version)throw new Error(`Version mismatch: package.json=${packageJson.version}, config.js=${configuredVersion||"missing"}`);

requireMarkers("API",sources.api,[
  "`aora:${CFG.slug}:${accessRole}`","REQUEST_TIMEOUT_MS","AbortController",
  'S.accessRole==="kiosk"?CFG.kioskWorkspaceFunction:CFG.workspaceFunction',
  "Eine Aktion wird bereits verarbeitet.","S.directory=null",
]);
requireMarkers("boot",sources.boot,["await ensureDirectory(accessRole)","document.hidden","backgroundRefreshRunning"]);
requireMarkers("handlers",sources.handlers,["managerInvitationModal()","employeeInvitationModal()"]);
requireMarkers("invitation",sources.invitation,[
  "function managerInvitationModal()","function employeeInvitationModal()","submit.disabled=true","invitationDeliveryModal(result.delivery)",
]);
for(const forbidden of ["function managerModal()","function employeeAccountModal()"]){
  if(sources.invitation.includes(forbidden))throw new Error(`Invitation module overrides base modal: ${forbidden}`);
}
requireMarkers("date overlay",sources.date,["isoDateValue","Date.UTC","getUTCDay","setUTCDate","timeZone:dateOnly?\"UTC\":CFG.tz"]);
requireMarkers("employee overlay",sources.employee,[
  "emp(S.session.subjectId)","note.employeeId===employee.id","note.read!==true","Das Mitarbeiterkonto wurde nicht gefunden.",
]);
requireMarkers("admin metrics overlay",sources.adminMetrics,[
  "function isActivatedAccount","status!==\"pending\"","Aktive Konten","Noch nicht aktiviert","function adminStats()",
]);
requireMarkers("kiosk overlay",sources.kiosk,['employee.status!=="pending"','employee.status!=="revoked"',"function renderKiosk()"]);
if(sources.canonicalKiosk.includes('status!=="pending"')||sources.canonicalKiosk.includes("aora-v8-hardening"))throw new Error("Canonical aora kiosk source was modified by the hardening layer.");

requireMarkers("access function",sources.accessFunction,["aora_consume_rate_limit","aora_accept_invitation_atomic","MAX_BODY_BYTES","Origin not allowed","TEAM_PREVIEW_SUFFIX"]);
requireMarkers("workspace function",sources.workspaceFunction,[
  "timesheetPeriods: []",'event?.type !== "KIOSK_TRANSITION"','type: "REQUEST_CLOCK"','target = "resume"',"MANAGER_LEGACY_TYPES","MAX_BODY_BYTES",
]);
requireMarkers("kiosk function",sources.kioskFunction,[
  'session.role !== "kiosk"','device.locked === true','item.status !== "pending"','item.status !== "revoked"',
  "new TextEncoder().encode(text).byteLength","KIOSK_TARGETS","Dieser Statuswechsel ist aktuell nicht möglich.","UPSTREAM_TIMEOUT_MS",
]);
requireMarkers("projection migration",sources.projectionMigration.toLowerCase(),[
  "aora_hardening_project_snapshot_trigger","aora-v8-hardening-demo","after update of state","project_workspace_state","revoke all","service_role",
]);
requireMarkers("kiosk login migration",sources.kioskLoginMigration,[
  "organization.status='active'","device.locked=true","Dieses Kiosk-Gerät ist gesperrt oder deaktiviert.","revoke all","service_role",
]);

requireMarkers("canonical visual identity",sources.baseCss,[
  "--black:#000","--white:#fff","--radius:16px",'--font:"Manrope",Arial,sans-serif','--display:"Sora","Manrope",sans-serif',".aora-logo",
]);
for(const forbidden of [/(^|})\s*:root\s*{/m,/(^|})\s*html\s*[{,]/m,/(^|})\s*body\s*[{,]/m,/(^|})\s*\*\s*{/m,/(^|})\s*\.aora-logo\s*{/m]){
  if(forbidden.test(sources.overlayCss))throw new Error(`Overlay replaces canonical visual selector: ${forbidden}`);
}
if(!sources.build.includes('`${originalCss}\\n\\n${extensionCss}\\n`'))throw new Error("Build must preserve canonical CSS first and append the isolated overlay second.");

console.log(`Aora hardening checks passed (${moduleFiles.length} overlay modules, version ${configuredVersion}, identity, access and isolation locked).`);
