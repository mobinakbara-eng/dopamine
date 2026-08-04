import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { aggregateDayEntries, buildCanonicalSnapshot } from "../supabase/functions/aora-v8-timesheet-document-signing-sync/aggregation.mjs";

const root=resolve(dirname(fileURLToPath(import.meta.url)),"..");
const read=path=>readFile(resolve(root,path),"utf8");
const [index,prepareSync,reportsSync,reportPrintFix,boot,identityHardening,edge]=await Promise.all([
  read("app/index.html"),
  read("app/modules/time-workflow-prepare-sync.js"),
  read("app/modules/reports-sync.js"),
  read("app/modules/reports-pdf-mobile-fix.js"),
  read("app/modules/boot.js"),
  read("app/modules/identity-hardening.js"),
  read("supabase/functions/aora-v8-timesheet-document-signing-sync/index.ts")
]);

assert.ok(!index.includes("timesheet-approval.js"),"obsolete reusable-signature approvals module must not be loaded");
assert.ok(!index.includes("timesheet-approval.css"),"obsolete approvals stylesheet must not be loaded");
for(const marker of ["time-workflow-prepare-sync.js?v=837","reports-sync.js?v=835","timesheet-document-signing.js?v=833"]){
  assert.ok(index.includes(marker),`missing synchronized workflow asset: ${marker}`);
}
assert.ok(
  index.indexOf("modules/admin.js")<index.indexOf("time-workflow-prepare-sync.js"),
  "Freigaben navigation must load after managerNav and ownerNav are defined"
);
assert.ok(
  index.indexOf("time-workflow-prepare-sync.js")<index.indexOf("timesheet-document-signing.js"),
  "prepare interception must load before document signing UI"
);
for(const marker of ["aora-v8-timesheet-document-signing-sync","stopImmediatePropagation","aora:timesheet-prepared","addApprovalsNavigation","managerNav","ownerNav"]){
  assert.ok(prepareSync.includes(marker),`missing prepare/navigation sync marker: ${marker}`);
}
assert.ok(!prepareSync.includes('document.addEventListener("DOMContentLoaded"'),"Freigaben navigation must not trigger an admin render during boot");
assert.ok(
  prepareSync.indexOf("addApprovalsNavigation();")<prepareSync.indexOf('document.addEventListener("click"'),
  "Freigaben navigation must register synchronously before boot without an extra render"
);
for(const marker of ["!S.state||!Array.isArray(S.state.admins)",'typeof renderLoading==="function"',"const admin=currentAdmin()"]){
  assert.ok(identityHardening.includes(marker),`missing pre-state admin-session guard: ${marker}`);
}
assert.ok(
  identityHardening.indexOf("!S.state||!Array.isArray(S.state.admins)")<identityHardening.indexOf("const admin=currentAdmin()"),
  "identity hardening must not invalidate a restored session before workspace state arrives"
);
for(const marker of ["alle Buchungen zusammengeführt","Live-Auswertung","Vollständig","Freigaben"]){
  assert.ok(reportsSync.includes(marker),`missing report synchronization marker: ${marker}`);
}
for(const marker of ["aoraReportBuildPrintBundle(all)",'data-a="report-print-all"',"printVisibleReport"]){
  assert.ok(reportPrintFix.includes(marker),`missing report print routing marker: ${marker}`);
}
for(const marker of ["buildCanonicalSnapshot","prepareTimesheet","TIMESHEET_DRAFT_REFRESHED","entryCount"]){
  assert.ok(edge.includes(marker),`missing synchronized edge marker: ${marker}`);
}
for(const marker of [
  "function authenticatedSession(preferredRole)",
  '[preferredRole,"owner","manager","employee","kiosk"]',
  "const recovered=callback.invitationId&&callback.token?authenticatedSession(pathRole):null",
  "setAccessRole(recovered.role)",
  "clearInvitationCallback(recovered.role)",
  'history.replaceState({},"",accessPath(accessRole))'
]){
  assert.ok(boot.includes(marker),`missing cross-role invitation-session marker: ${marker}`);
}
assert.ok(
  boot.indexOf("const recovered=callback.invitationId&&callback.token?authenticatedSession(pathRole):null")<boot.indexOf("if(redirectInvitationToCanonicalOrigin(callback))return"),
  "an authenticated session from any valid role must be recovered before an invitation callback can redirect"
);
assert.ok(
  boot.indexOf("if(recovered)")<boot.indexOf("renderInvitationSetup(info,callback.invitationId,callback.token)"),
  "an authenticated session must restore its canonical role route before invitation activation can render"
);

const twoSegments=[
  {date:"2026-08-04",start:"08:00",end:"12:00",breakMinutes:0,status:"closed"},
  {date:"2026-08-04",start:"14:00",end:"18:00",breakMinutes:30,status:"closed"}
];
const day=aggregateDayEntries(twoSegments);
assert.equal(day.type,"Arbeit");
assert.equal(day.entryCount,2);
assert.equal(day.start,"08:00 / 14:00");
assert.equal(day.end,"12:00 / 18:00");
assert.equal(day.netMinutes,450);
assert.equal(day.breakMinutes,30);
assert.match(day.note,/2 Buchungen/);

const state={
  company:{name:"Test Arbeitgeber"},
  timeEntries:twoSegments.map((entry,index)=>({...entry,id:`entry-${index}`,employeeId:"employee-1",locationId:"location-1"})),
  shifts:[{id:"shift-1",employeeId:"employee-1",locationId:"location-1",date:"2026-08-04",start:"08:00",end:"18:00",breakMinutes:60}],
  leaveRequests:[]
};
const snapshot=buildCanonicalSnapshot({
  state,
  organization:{id:"organization-1",name:"Test Arbeitgeber"},
  employee:{id:"employee-1",name:"Test Employee",weeklyHours:40,locationId:"location-1"},
  location:{id:"location-1",name:"Testfiliale"},
  locationId:"location-1",
  from:"2026-08-04",
  to:"2026-08-04",
  generatedAt:"2026-08-04T12:00:00.000Z"
});
assert.equal(snapshot.schemaVersion,3);
assert.equal(snapshot.rows.length,1);
assert.equal(snapshot.rows[0].entryCount,2);
assert.equal(snapshot.totals.entryCount,2);
assert.equal(snapshot.totals.workedMinutes,450);
assert.equal(snapshot.totals.totalMinutes,450);
assert.equal(snapshot.totals.plannedMinutes,540);
assert.equal(snapshot.totals.differenceMinutes,-90);
assert.equal(snapshot.totals.openDays,0);

const openSnapshot=buildCanonicalSnapshot({
  state:{...state,timeEntries:[state.timeEntries[0],{id:"entry-open",employeeId:"employee-1",locationId:"location-1",date:"2026-08-04",start:"14:00",end:"",status:"live"}]},
  organization:{id:"organization-1",name:"Test Arbeitgeber"},
  employee:{id:"employee-1",name:"Test Employee",weeklyHours:40,locationId:"location-1"},
  location:{id:"location-1",name:"Testfiliale"},
  locationId:"location-1",
  from:"2026-08-04",
  to:"2026-08-04",
  generatedAt:"2026-08-04T12:00:00.000Z"
});
assert.equal(openSnapshot.rows[0].type,"Offen");
assert.equal(openSnapshot.rows[0].netMinutes,240,"completed segments must remain counted while another segment is open");
assert.equal(openSnapshot.totals.workedMinutes,240);
assert.equal(openSnapshot.totals.openDays,1);

console.log("Time workflow synchronization contract passed: dependency-safe Freigaben navigation without premature rendering, protected admin session restoration, one approvals UI, multi-entry daily aggregation, matching live report semantics, distinct print routes, cross-role invitation session recovery and synchronized snapshots.");
