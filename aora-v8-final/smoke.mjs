import { execFileSync } from "node:child_process";
import { access, readdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root=dirname(fileURLToPath(import.meta.url));
const dist=resolve(root,"dist");

async function exists(relativePath){
  await access(resolve(dist,relativePath)).catch(()=>{throw new Error(`Missing built asset: ${relativePath}`)});
}
function requireMarkers(name,source,markers){
  for(const marker of markers){
    if(!source.includes(marker))throw new Error(`Missing built ${name} marker: ${marker}`);
  }
}

for(const relativePath of [
  "index.html","styles.css","invitation.css",
  "modules/config.js","modules/date-hardening.js","modules/api.js","modules/access.js",
  "modules/employee-hardening.js","modules/kiosk-hardening.js","modules/invitation-delivery.js",
  "modules/handlers.js","modules/boot.js",
  "inhaber/index.html","arbeitgeber/index.html","arbeitnehmer/index.html","kiosk/dashboard/index.html",
])await exists(relativePath);

const rootIndex=await readFile(resolve(dist,"index.html"),"utf8");
requireMarkers("index",rootIndex,[
  "AoraAI Workforce","styles.css?v=808","invitation.css?v=808",
  "modules/config.js?v=808","modules/date-hardening.js?v=808","modules/api.js?v=808",
  "modules/employee-hardening.js?v=808","modules/kiosk-hardening.js?v=808",
  "modules/invitation-delivery.js?v=808","modules/handlers.js?v=808","modules/boot.js?v=808",
]);
for(const route of ["inhaber","arbeitgeber","arbeitnehmer","kiosk/dashboard"]){
  const routeIndex=await readFile(resolve(dist,route,"index.html"),"utf8");
  if(routeIndex!==rootIndex)throw new Error(`Route shell differs from canonical build: ${route}`);
}

const config=await readFile(resolve(dist,"modules/config.js"),"utf8");
requireMarkers("config",config,[
  'slug:"aora-v8-hardening-demo"',
  'accessFunction:"aora-v8-hardening-access"',
  'workspaceFunction:"aora-v8-hardening-workspace"',
  'kioskWorkspaceFunction:"aora-v8-hardening-kiosk"',
  'version:"8.0.8-hardening"',
]);
for(const forbidden of ['slug:"aora-v8-final-demo"','accessFunction:"aora-v8-final-access"','workspaceFunction:"aora-v8-final-workspace"']){
  if(config.includes(forbidden))throw new Error(`Built output points to old service: ${forbidden}`);
}

const api=await readFile(resolve(dist,"modules/api.js"),"utf8");
requireMarkers("API",api,["REQUEST_TIMEOUT_MS","AbortController",'S.accessRole==="kiosk"?CFG.kioskWorkspaceFunction:CFG.workspaceFunction']);
const date=await readFile(resolve(dist,"modules/date-hardening.js"),"utf8");
requireMarkers("date",date,["Date.UTC","getUTCDay","setUTCDate"]);
const employee=await readFile(resolve(dist,"modules/employee-hardening.js"),"utf8");
requireMarkers("employee",employee,["emp(S.session.subjectId)","note.read!==true"]);
const kiosk=await readFile(resolve(dist,"modules/kiosk-hardening.js"),"utf8");
requireMarkers("kiosk",kiosk,['employee.status!=="pending"','employee.status!=="revoked"']);
const invitation=await readFile(resolve(dist,"modules/invitation-delivery.js"),"utf8");
requireMarkers("invitation",invitation,["managerInvitationModal","employeeInvitationModal","submit.disabled=true"]);

const css=await readFile(resolve(dist,"styles.css"),"utf8");
requireMarkers("visual",css,[
  "--black:#000","--white:#fff","--radius:16px",
  '--font:"Manrope",Arial,sans-serif','--display:"Sora","Manrope",sans-serif',".owner-hero",
]);

const modulesDirectory=resolve(dist,"modules");
const modules=(await readdir(modulesDirectory)).filter(file=>file.endsWith(".js")).sort();
if(modules.length<18)throw new Error(`Unexpected built module count: ${modules.length}`);
for(const module of modules){
  execFileSync(process.execPath,["--check",resolve(modulesDirectory,module)],{stdio:"inherit"});
}

console.log(`Aora post-build smoke checks passed (${modules.length} modules, 4 role routes, authenticated employee, stable dates, guarded kiosk, visual markers).`);
