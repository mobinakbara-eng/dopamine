import { readFile } from "node:fs/promises";
import { strict as assert } from "node:assert";

const [ui, edge, migration, index] = await Promise.all([
  readFile(new URL("../app/modules/shift-preferences.js", import.meta.url), "utf8"),
  readFile(new URL("../supabase/functions/aora-v8-shift-preferences/index.ts", import.meta.url), "utf8"),
  readFile(new URL("../supabase/migrations/202608020100_aora_shift_preferences.sql", import.meta.url), "utf8"),
  readFile(new URL("../app/index.html", import.meta.url), "utf8"),
]);

assert.match(ui, /originalEmployeeCalendar/);
assert.match(ui, /originalAdminView/);
assert.match(ui, /decorateEmployeeCalendar/);
assert.match(ui, /decorateManagerSchedule/);
assert.match(ui, /aora-cal-entry aora-cal-entry-shift/);
assert.match(ui, /class="u-item-card"/);
assert.match(ui, /class="u-actions"/);
assert.match(ui, /modalHeader\("Kalender", "Schichtwunsch abgeben"\)/);
assert.match(ui, /modalHeader\("Dienstplan", "Schichtwunsch prüfen"\)/);
assert.doesNotMatch(ui, /sp-planner|sp-modal|managerSchedulePage|sp-schedule-page/);
assert.doesNotMatch(index, /shift-preferences\.css/);
assert.match(index, /modules\/shift-preferences\.js/);
assert.match(index, /reports-pdf-mobile-fix\.js/);

assert.match(edge, /aora_shift_preference_action/);
assert.doesNotMatch(edge, /validate_demo_session/);
assert.doesNotMatch(edge, /\.from\("aora_shift_preferences"\)/);
assert.doesNotMatch(edge, /action === "load"/);

assert.match(migration, /alter table public\.shift_requests alter column shift_id drop not null/);
assert.match(migration, /request_type='shift_preference'/);
assert.match(migration, /insert into public\.shift_requests/);
assert.match(migration, /insert into public\.shifts/);
assert.match(migration, /insert into public\.notifications/);
assert.match(migration, /insert into public\.audit_logs/);
assert.match(migration, /aora_evaluate_shift_rules/);
assert.match(migration, /aora_commit_workspace_state/);
assert.match(migration, /drop table if exists public\.aora_shift_preferences/);
assert.match(migration, /drop function if exists public\.aora_decide_shift_preference/);
assert.doesNotMatch(migration, /create table if not exists public\.aora_shift_preferences/);

console.log("shift preference canonical integration contract: ok");
