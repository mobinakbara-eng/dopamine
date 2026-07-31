import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root=resolve(import.meta.dirname,"..");
const read=path=>readFile(resolve(root,path),"utf8");
const [index,features,calendarRedesign,calendarStyles,worker,serviceWorker,domainApi]=await Promise.all([
  read("app/index.html"),
  read("app/modules/unified-features.js"),
  read("app/modules/calendar-aora-redesign.js"),
  read("app/calendar-aora-redesign.css"),
  read("app/modules/worker-config.js"),
  read("app/sw.js"),
  read("supabase/functions/aora-v8-domain-api/index.ts")
]);

const requiredIndexMarkers=[
  "features-v2.css?v=823",
  "modules/worker-config.js?v=823",
  "modules/unified-features.js?v=823",
  "calendar-aora-redesign.css?v=826",
  "modules/calendar-aora-redesign.js?v=826"
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
if(index.indexOf("modules/calendar-aora-redesign.js?v=826")<index.indexOf("modules/unified-features.js?v=823")||index.indexOf("modules/calendar-aora-redesign.js?v=826")>index.indexOf("modules/handlers.js?v=822")){
  throw new Error("The Aora calendar redesign must load after unified features and before handlers.");
}
for(const marker of [
  'CFG.domainFunction=CFG.domainFunction||"aora-v8-domain-api"',
  'CFG.featureFunction=CFG.featureFunction||"aora-v8-feature-actions"',
  'calendar_v2',
  'schedule_board_v2',
  'task_automation',
  'task-submit',
  'serviceWorker.register'
]){
  if(!features.includes(marker))throw new Error(`Missing unified feature runtime marker: ${marker}`);
}
for(const marker of [
  'globalThis.uCalendarPage = function aoraCalendarPage',
  'aora-calendar-grid',
  'aora-cal-sheet',
  'data-u="calendar-day"',
  'data-aora-calendar="filter-toggle"',
  'version: "826"'
]){
  if(!calendarRedesign.includes(marker))throw new Error(`Missing Aora calendar redesign marker: ${marker}`);
}
for(const marker of [
  '.aora-calendar-page',
  '.aora-calendar-grid',
  '.aora-cal-sheet',
  '@media(max-width:700px)',
  '.aora-cal-day.is-selected'
]){
  if(!calendarStyles.includes(marker))throw new Error(`Missing Aora calendar style marker: ${marker}`);
}
for(const marker of ['case"clockoutGate"','case"managerOverride"','case"submitTask"']){
  if(!domainApi.includes(marker))throw new Error(`Missing unified domain gate marker: ${marker}`);
}
for(const marker of ["globalThis.ensureWorker","AORA_CONFIG","supabaseUrl:CFG.url","kioskFunction:CFG.kioskWorkspaceFunction"]){
  if(!worker.includes(marker))throw new Error(`Missing worker environment marker: ${marker}`);
}
for(const forbidden of ["xqgkawskftzurbujrpex","lxpmgnllgqdulfjxbdau"]){
  if(serviceWorker.includes(forbidden))throw new Error(`Service worker contains a hard-coded project reference: ${forbidden}`);
}
console.log("Unified workforce source gate passed: canonical entry point, Aora calendar redesign, feature runtime, domain gates and environment-safe service worker are wired.");
