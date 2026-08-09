import assert from "node:assert/strict";
import fs from "node:fs";

const backend=fs.readFileSync(new URL("../supabase/functions/aora-v8-pilot-workspace/index.ts",import.meta.url),"utf8");
const modal=fs.readFileSync(new URL("../app/modules/modals.js",import.meta.url),"utf8");
const structuralTypes=backend.match(/const STRUCTURAL_TYPES = new Set\(\[([\s\S]*?)\]\);/)?.[1]||"";

assert.ok(
  structuralTypes.includes('"ADD_ANNOUNCEMENT"'),
  "Manager Team News must route to the secured structural handler instead of the employee-only legacy workspace",
);

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
