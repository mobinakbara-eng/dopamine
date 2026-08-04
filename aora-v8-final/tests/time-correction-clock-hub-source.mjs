import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root=resolve(import.meta.dirname,"..");
const [index,module,css]=await Promise.all([
  readFile(resolve(root,"app/index.html"),"utf8"),
  readFile(resolve(root,"app/modules/time-correction-clock-hub.js"),"utf8"),
  readFile(resolve(root,"app/time-correction-clock-hub.css"),"utf8")
]);
const required=[
  [index.includes('time-correction-clock-hub.css'),"time hub stylesheet is not loaded"],
  [index.includes('modules/time-correction-clock-hub.js'),"time hub module is not loaded"],
  [index.indexOf('modules/time-correction-clock-hub.js')>index.indexOf('modules/shift-preferences.js'),"time hub must wrap the final employee/admin views"],
  [module.includes('Korrektur & Stempeluhr'),"integrated employee/manager title is missing"],
  [module.includes('data-time-hub-action="correct-entry"'),"per-entry correction action is missing"],
  [module.includes('target="_blank" rel="noopener noreferrer"'),"safe non-destructive kiosk link is missing"],
  [module.includes('.employee-correction-fab'),"legacy floating correction button is not removed"],
  [module.includes('data-view="approvals"'),"timesheet approval handoff is missing"],
  [module.includes('data-view="compliance"'),"compliance/audit handoff is missing"],
  [module.includes('MutationObserver'),"successful correction refresh is missing"],
  [css.includes('@media(max-width:760px)'),"mobile layout rules are missing"]
];
for(const [ok,message] of required)if(!ok)throw new Error(message);
if(/data-a="open-kiosk"/.test(module))throw new Error("Integrated time hub must not use the destructive role-switching kiosk action.");
console.log("Time correction and clock hub source gate passed.");
