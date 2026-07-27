import { execFileSync } from "node:child_process";
import { access, readdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root=dirname(fileURLToPath(import.meta.url));
const dist=resolve(root,"dist");
async function exists(relativePath){await access(resolve(dist,relativePath)).catch(()=>{throw new Error(`Missing built asset: ${relativePath}`)})}
function requireMarkers(name,source,markers){for(const marker of markers)if(!source.includes(marker))throw new Error(`Missing built ${name} marker: ${marker}`)}
function forbidMarkers(name,source,markers){for(const marker of markers)if(source.includes(marker))throw new Error(`Forbidden built ${name} marker: ${marker}`)}

for(const relativePath of [
  "index.html","styles.css","invitation.css","modules/config.js","modules/date-hardening.js","modules/api.js",
  "modules/access.js","modules/employee-hardening.js","modules/identity-hardening.js","modules/profile-hardening.js",
  "modules/admin-metrics-hardening.js","modules/kiosk-hardening.js","modules/invitation-delivery.js",
  "modules/handlers.js","modules/boot.js","inhaber/index.html","arbeitgeber/index.html","arbeitnehmer/index.html","kiosk/dashboard/index.html",
])await exists(relativePath);

const rootIndex=await readFile(resolve(dist,"index.html"),"utf8");
requireMarkers("index",rootIndex,[
  "AoraAI Workforce","styles.css?v=809","invitation.css?v=809","modules/config.js?v=809",
  "modules/api.js?v=809","modules/access.js?v=809","modules/employee-hardening.js?v=809",
  "modules/identity-hardening.js?v=809","modules/profile-hardening.js?v=809","modules/handlers.js?v=809",
]);
for(const route of ["inhaber","arbeitgeber","arbeitnehmer","kiosk/dashboard"]){
  const routeIndex=await readFile(resolve(dist,route,"index.html"),"utf8");
  if(routeIndex!==rootIndex)throw new Error(`Route shell differs from canonical build: ${route}`);
}

const config=await readFile(resolve(dist,"modules/config.js"),"utf8");
requireMarkers("config",config,[
  'slug:"aora-v8-hardening-demo"','accessFunction:"aora-v8-hardening-access"',
  'workspaceFunction:"aora-v8-hardening-workspace"','kioskWorkspaceFunction:"aora-v8-hardening-kiosk"',
  'version:"8.0.9-hardening"',
]);
for(const forbidden of ['slug:"aora-v8-final-demo"','accessFunction:"aora-v8-final-access"','workspaceFunction:"aora-v8-final-workspace"']){
  if(config.includes(forbidden))throw new Error(`Built output points to old service: ${forbidden}`);
}

const api=await readFile(resolve(dist,"modules/api.js"),"utf8");
requireMarkers("API",api,["REQUEST_TIMEOUT_MS","AbortController",'if(accessRole!=="kiosk")return','if(loginRole!=="kiosk")']);
const accessUi=await readFile(resolve(dist,"modules/access.js"),"utf8");
requireMarkers("access UI",accessUi,['const pinEnabled=role==="kiosk"','Inhaber, Arbeitgeber und Mitarbeiter melden sich ausschließlich']);
forbidMarkers("access UI",accessUi,['role==="owner"||role==="kiosk"']);
const date=await readFile(resolve(dist,"modules/date-hardening.js"),"utf8");
requireMarkers("date",date,["Date.UTC","getUTCDay","setUTCDate"]);
const employee=await readFile(resolve(dist,"modules/employee-hardening.js"),"utf8");
requireMarkers("employee",employee,[
  "employeeScopedState","activeEntryMinutes","pendingClockRequest","clockApprovalPanel","clock-approve","clock-deny",
  "Das angemeldete Mitarbeiterkonto wurde nicht gefunden",
]);
forbidMarkers("employee",employee,["employees?.[0]","employees[0]"]);
const identity=await readFile(resolve(dist,"modules/identity-hardening.js"),"utf8");
requireMarkers("identity",identity,["item.id===subjectId","item.status!==\"pending\"","renderAdminCanonical"]);
forbidMarkers("identity",identity,["admins?.[0]","admins[0]"]);
const profile=await readFile(resolve(dist,"modules/profile-hardening.js"),"utf8");
requireMarkers("profile",profile,["item.id===employeeId","UPDATE_PROFILE"]);
forbidMarkers("profile",profile,["employees?.[0]","employees[0]"]);
const handlers=await readFile(resolve(dist,"modules/handlers.js"),"utf8");
requireMarkers("handlers",handlers,[
  "secureCurrentPosition","APPROVE_CLOCK_REQUEST","DENY_CLOCK_REQUEST","return-admin-role",
  "Bitte erneut anmelden, um den Verwaltungsbereich zu öffnen.",
]);
const adminMetrics=await readFile(resolve(dist,"modules/admin-metrics-hardening.js"),"utf8");
requireMarkers("admin metrics",adminMetrics,["isActivatedAccount","Aktive Konten","Noch nicht aktiviert"]);
const kiosk=await readFile(resolve(dist,"modules/kiosk-hardening.js"),"utf8");
requireMarkers("kiosk",kiosk,['employee.status!=="pending"','employee.status!=="revoked"']);
const invitation=await readFile(resolve(dist,"modules/invitation-delivery.js"),"utf8");
requireMarkers("invitation",invitation,["managerInvitationModal","employeeInvitationModal","submit.disabled=true"]);

const css=await readFile(resolve(dist,"styles.css"),"utf8");
requireMarkers("visual",css,[
  "--black:#000","--white:#fff","--radius:16px",'--font:"Manrope",Arial,sans-serif','--display:"Sora","Manrope",sans-serif',".owner-hero",
]);
const modulesDirectory=resolve(dist,"modules");
const modules=(await readdir(modulesDirectory)).filter(file=>file.endsWith(".js")).sort();
if(modules.length<21)throw new Error(`Unexpected built module count: ${modules.length}`);
for(const module of modules)execFileSync(process.execPath,["--check",resolve(modulesDirectory,module)],{stdio:"inherit"});

console.log(`Aora post-build smoke checks passed (${modules.length} modules, 4 role routes, exact identities, personal punch approval, kiosk re-auth, active hours and visual markers).`);
