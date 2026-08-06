from pathlib import Path
import json

root = Path("aora-v8-final")
backend_path = root / "supabase/functions/aora-v8-pilot-workspace/index.ts"
backend = backend_path.read_text()

old_scope = """    correctionRequests: source.correctionRequests.filter((item: any) => employeeIds.has(String(item.employeeId))),
    notifications: source.notifications.filter((item: any) => employeeIds.has(String(item.employeeId)) || locations.has(String(item.locationId))),"""
new_scope = """    correctionRequests: source.correctionRequests.filter((item: any) => employeeIds.has(String(item.employeeId))),
    announcements: source.announcements.filter((item: any) => item.audience === "all" || locations.has(String(item.audience))),
    notifications: source.notifications.filter((item: any) => employeeIds.has(String(item.employeeId)) || locations.has(String(item.locationId))),"""
if old_scope in backend:
    backend = backend.replace(old_scope, new_scope, 1)
elif new_scope not in backend:
    raise SystemExit("manager announcement scope insertion point not found")

old_locations = """  add(event?.locationId); add(event?.shift?.locationId); add(event?.employee?.locationId); add(event?.patch?.locationId); add(event?.assignment?.locationId);
  add(state.shifts.find((item: any) => item.id === event?.id || item.id === event?.shiftId)?.locationId);"""
new_locations = """  add(event?.locationId); add(event?.shift?.locationId); add(event?.employee?.locationId); add(event?.patch?.locationId); add(event?.assignment?.locationId);
  const announcementAudience = event?.announcement?.audience;
  if (announcementAudience && announcementAudience !== "all") add(announcementAudience);
  add(state.shifts.find((item: any) => item.id === event?.id || item.id === event?.shiftId)?.locationId);"""
if old_locations in backend:
    backend = backend.replace(old_locations, new_locations, 1)
elif new_locations not in backend:
    raise SystemExit("announcement audience location insertion point not found")

old_guard = """function guardManagerEvent(ctx: any, event: any) {
  const locations = allowedLocations(ctx);
  const eventLocations = eventLocationIds(ctx.state, event);
  if (!event?.type || !eventLocations.length || eventLocations.some((locationId) => !locations.has(locationId))) throw Object.assign(new Error("Kein Zugriff auf diesen Standort."), { status: 403 });
}"""
new_guard = """function guardManagerEvent(ctx: any, event: any) {
  const locations = allowedLocations(ctx);
  if (!event?.type) throw Object.assign(new Error("Aktion fehlt."), { status: 400 });
  if (event.type === "ADD_ANNOUNCEMENT" && event?.announcement?.audience === "all") {
    throw Object.assign(new Error("Manager dürfen Mitteilungen nur an ihre zugewiesenen Standorte senden."), { status: 403 });
  }
  const eventLocations = eventLocationIds(ctx.state, event);
  if (!eventLocations.length) {
    throw Object.assign(new Error("Der Standort dieser Aktion konnte nicht sicher bestimmt werden."), { status: 403 });
  }
  if (eventLocations.some((locationId) => !locations.has(locationId))) {
    throw Object.assign(new Error("Kein Zugriff auf diesen Standort."), { status: 403 });
  }
}"""
if old_guard in backend:
    backend = backend.replace(old_guard, new_guard, 1)
elif new_guard not in backend:
    raise SystemExit("manager guard replacement point not found")
backend_path.write_text(backend)

modal_path = root / "app/modules/modals.js"
modal = modal_path.read_text()
old_submit = """  backdrop.querySelector("form").addEventListener("submit",async event=>{
    event.preventDefault();
    const announcement=Object.fromEntries(new FormData(event.currentTarget));
    try{await apply({type:"ADD_ANNOUNCEMENT",announcement});backdrop.remove()}catch{}
  });
}"""
new_submit = """  backdrop.querySelector("form").addEventListener("submit",async event=>{
    event.preventDefault();
    const form=event.currentTarget;
    const submit=form.querySelector('button[type="submit"]');
    if(submit?.disabled)return;
    if(submit)submit.disabled=true;
    const announcement=Object.fromEntries(new FormData(form));
    announcement.title=String(announcement.title||"").trim();
    announcement.body=String(announcement.body||"").trim();
    if(!announcement.title||!announcement.body){
      if(submit)submit.disabled=false;
      return toast("Titel und Text dürfen nicht leer sein.","error");
    }
    try{
      await apply({type:"ADD_ANNOUNCEMENT",announcement});
      backdrop.remove();
      toast("Mitteilung wurde veröffentlicht.");
    }catch{
      if(submit?.isConnected)submit.disabled=false;
    }
  });
}"""
if old_submit in modal:
    modal = modal.replace(old_submit, new_submit, 1)
elif new_submit not in modal:
    raise SystemExit("Team News modal submit replacement point not found")
modal_path.write_text(modal)

test_path = root / "tests/team-news-location-guard-source.mjs"
test_path.write_text('''import assert from "node:assert/strict";
import fs from "node:fs";

const backend=fs.readFileSync(new URL("../supabase/functions/aora-v8-pilot-workspace/index.ts",import.meta.url),"utf8");
const modal=fs.readFileSync(new URL("../app/modules/modals.js",import.meta.url),"utf8");

for(const fragment of [
  'announcements: source.announcements.filter((item: any) => item.audience === "all" || locations.has(String(item.audience)))',
  'const announcementAudience = event?.announcement?.audience;',
  'if (announcementAudience && announcementAudience !== "all") add(announcementAudience);',
  'event.type === "ADD_ANNOUNCEMENT" && event?.announcement?.audience === "all"',
  'Manager dürfen Mitteilungen nur an ihre zugewiesenen Standorte senden.',
  'Der Standort dieser Aktion konnte nicht sicher bestimmt werden.',
]) assert.ok(backend.includes(fragment),`missing backend Team News contract: ${fragment}`);

for(const fragment of [
  'if(submit?.disabled)return;',
  'if(submit)submit.disabled=true;',
  'announcement.title=String(announcement.title||"").trim();',
  'announcement.body=String(announcement.body||"").trim();',
  'toast("Mitteilung wurde veröffentlicht.");',
  'if(submit?.isConnected)submit.disabled=false;',
]) assert.ok(modal.includes(fragment),`missing Team News modal contract: ${fragment}`);

assert.equal((backend.match(/const announcementAudience = event\?\.announcement\?\.audience;/g)||[]).length,1,"announcement audience guard must be unique");
assert.equal((backend.match(/announcements: source\.announcements\.filter/g)||[]).length,1,"manager announcement projection must be unique");
console.log("Team News location guard source contracts passed");
''')

package_path = root / "package.json"
package = json.loads(package_path.read_text())
check = package["scripts"]["check"]
command = "node tests/team-news-location-guard-source.mjs"
if command not in check:
    marker = "node tests/backend-tenancy-source.mjs"
    if marker not in check:
        raise SystemExit("package check insertion point not found")
    check = check.replace(marker, marker + " && " + command, 1)
    package["scripts"]["check"] = check
    package_path.write_text(json.dumps(package, ensure_ascii=False, indent=2) + "\n")
