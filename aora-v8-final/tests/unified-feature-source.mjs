import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root=resolve(import.meta.dirname,"..");
const read=path=>readFile(resolve(root,path),"utf8");
const [index,features,worker,serviceWorker]=await Promise.all([
  read("app/index.html"),
  read("app/modules/unified-features.js"),
  read("app/modules/worker-config.js"),
  read("app/sw.js")
]);

const requiredIndexMarkers=[
  "features-v2.css?v=823",
  "modules/worker-config.js?v=823",
  "modules/unified-features.js?v=823"
];
for(const marker of requiredIndexMarkers){
  if(!index.includes(marker))throw new Error(`Unified feature asset is not loaded by index.html: ${marker}`);
}
if(index.indexOf("modules/worker-config.js?v=823")>index.indexOf("modules/unified-features.js?v=823")){
  throw new Error("Worker runtime configuration must load before unified features.");
}
if(index.indexOf("modules/unified-features.js?v=823")>index.indexOf("modules/handlers.js?v=822")){
  throw new Error("Unified features must wrap views before handler and boot initialization.");
}
for(const marker of [
  'CFG.domainFunction=CFG.domainFunction||"aora-v8-domain-api"',
  'CFG.featureFunction=CFG.featureFunction||"aora-v8-feature-actions"',
  'calendar_v2',
  'schedule_board_v2',
  'task_automation',
  'clockoutGate',
  'serviceWorker.register'
]){
  if(!features.includes(marker))throw new Error(`Missing unified feature runtime marker: ${marker}`);
}
for(const marker of ["globalThis.ensureWorker","AORA_CONFIG","supabaseUrl:CFG.url","kioskFunction:CFG.kioskWorkspaceFunction"]){
  if(!worker.includes(marker))throw new Error(`Missing worker environment marker: ${marker}`);
}
for(const forbidden of ["xqgkawskftzurbujrpex","lxpmgnllgqdulfjxbdau"]){
  if(serviceWorker.includes(forbidden))throw new Error(`Service worker contains a hard-coded project reference: ${forbidden}`);
}
console.log("Unified workforce source gate passed: canonical entry point, feature runtime and environment-safe service worker are wired.");
