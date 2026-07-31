import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root=resolve(import.meta.dirname,"..");
const appRoot=resolve(root,"app");

async function walk(directory){
  const entries=await readdir(directory,{withFileTypes:true});
  const files=[];
  for(const entry of entries){
    const path=resolve(directory,entry.name);
    if(entry.isDirectory())files.push(...await walk(path));
    else if(/\.(?:js|html)$/.test(entry.name))files.push(path);
  }
  return files;
}
function collect(source,regex){
  const values=new Set();
  for(const match of source.matchAll(regex))values.add(match[1]);
  return values;
}
function union(...sets){return new Set(sets.flatMap(set=>[...set]))}

const files=await walk(appRoot);
const sources=[];
for(const path of files)sources.push({path,source:await readFile(path,"utf8")});
const all=sources.map(item=>item.source).join("\n");
const byName=name=>sources.find(item=>item.path.endsWith(name))?.source||"";

const renderedA=collect(all,/data-a=\\?["']([a-z0-9-]+)\\?["']/gi);
const renderedU=union(
  collect(all,/data-u=\\?["']([a-z0-9-]+)\\?["']/gi),
  collect(all,/uButton\([^,]+,\s*["']([a-z0-9-]+)["']/gi)
);
const renderedCompliance=collect(all,/data-compliance-action=\\?["']([a-z0-9-]+)\\?["']/gi);
const renderedCalendar=collect(all,/data-aora-calendar=\\?["']([a-z0-9-]+)\\?["']/gi);
const renderedProduction=collect(all,/data-production-action=\\?["']([a-z0-9-]+)\\?["']/gi);

const comparisonHandlers=union(
  collect(all,/\baction\s*={2,3}\s*["']([a-z0-9-]+)["']/gi),
  collect(all,/\bcase\s*["']([a-z0-9-]+)["']\s*:/gi)
);
const selectorHandlers=union(
  collect(all,/closest\(\s*["']\[data-a=\\?["']([a-z0-9-]+)\\?["']\]["']\s*\)/gi),
  collect(all,/querySelector\(\s*["'][^"']*data-a=\\?["']([a-z0-9-]+)\\?["'][^"']*["']\s*\)/gi)
);
const explicitA=new Set(["close"]);
const handledA=union(comparisonHandlers,selectorHandlers,explicitA);

const missingA=[...renderedA].filter(action=>!handledA.has(action)).sort();
const missingU=[...renderedU].filter(action=>!comparisonHandlers.has(action)).sort();
const missingCompliance=[...renderedCompliance].filter(action=>!comparisonHandlers.has(action)).sort();
const missingCalendar=[...renderedCalendar].filter(action=>!comparisonHandlers.has(action)).sort();
const missingProduction=[...renderedProduction].filter(action=>!comparisonHandlers.has(action)&&action!=="copy-reset-link").sort();

const productionExperience=byName("modules/production-experience.js");
const domainRouting=byName("modules/domain-patch-routing.js");
const unifiedFeatures=byName("modules/unified-features.js");
const domainPatch=await readFile(resolve(root,"supabase/functions/aora-v8-domain-patch/index.ts"),"utf8");
const recovery=await readFile(resolve(root,"supabase/functions/aora-v8-account-recovery/index.ts"),"utf8");
const build=await readFile(resolve(root,"build.mjs"),"utf8");
const index=byName("index.html");

const requiredPatchActions=["evidenceUpload","confirmEvidence","pushSubscribe","pushUnsubscribe","managerOverride","createShiftSeries"];
const requiredRecoveryActions=["requestReset","requestSupport","listRequests","approveReset","cancelReset","closeSupport","resetPassword"];
const errors=[];

if(missingA.length)errors.push(`Rendered data-a actions without a handler: ${missingA.join(", ")}`);
if(missingU.length)errors.push(`Rendered data-u actions without a handler: ${missingU.join(", ")}`);
if(missingCompliance.length)errors.push(`Rendered compliance actions without a handler: ${missingCompliance.join(", ")}`);
if(missingCalendar.length)errors.push(`Rendered calendar actions without a handler: ${missingCalendar.join(", ")}`);
if(missingProduction.length)errors.push(`Rendered production actions without a handler: ${missingProduction.join(", ")}`);

if(!productionExperience.includes('button[aria-label="Benachrichtigungen"]'))errors.push("Notification bell selector is not wired.");
if(!productionExperience.includes('uCall("markNotificationRead"'))errors.push("Employee notification read state is not persisted.");
if(!productionExperience.includes("productionBaseRenderLogin"))errors.push("Login recovery enhancement is not installed.");
if(!build.includes('"reset-password"'))errors.push("Reset-password route is not emitted by the build.");
if(!index.includes("modules/domain-patch-routing.js")||!index.includes("modules/production-experience.js"))errors.push("Production hardening modules are missing from index.html.");

for(const action of requiredPatchActions){
  if(!domainRouting.includes(`"${action}"`))errors.push(`Patch routing is missing ${action}.`);
  if(!domainPatch.includes(`case"${action}"`))errors.push(`Domain patch endpoint is missing ${action}.`);
}
for(const action of ["evidenceUpload","confirmEvidence","pushSubscribe"]){
  if(!unifiedFeatures.includes(`"${action}"`))errors.push(`Unified frontend no longer references required action ${action}.`);
}
for(const action of requiredRecoveryActions){
  if(!productionExperience.includes(`"${action}"`))errors.push(`Production experience is missing recovery action ${action}.`);
  if(!recovery.includes(`case"${action}"`))errors.push(`Recovery endpoint is missing ${action}.`);
}

if(errors.length)throw new Error(errors.join("\n\n"));
console.log(`Interaction contract passed: ${renderedA.size} data-a, ${renderedU.size} data-u, ${renderedCompliance.size} compliance, ${renderedCalendar.size} calendar and ${renderedProduction.size} production actions are wired.`);
