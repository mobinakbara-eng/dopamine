import { readFile } from "node:fs/promises";
import { strict as assert } from "node:assert";

const [ui, css, edge, migration] = await Promise.all([
  readFile(new URL("../app/modules/shift-preferences.js", import.meta.url), "utf8"),
  readFile(new URL("../app/shift-preferences.css", import.meta.url), "utf8"),
  readFile(new URL("../supabase/functions/aora-v8-shift-preferences/index.ts", import.meta.url), "utf8"),
  readFile(new URL("../supabase/migrations/202608020100_aora_shift_preferences.sql", import.meta.url), "utf8"),
]);

assert.match(ui, /Schicht wünschen/);
assert.match(ui, /sp-ghost-card/);
assert.match(ui, /decision: "accepted"/);
assert.match(ui, /decision: "rejected"/);
assert.match(ui, /expectedRevision: S\.revision/);
assert.match(css, /border:1px dashed/);
assert.match(edge, /validate_demo_session/);
assert.match(edge, /manager_location_access/);
assert.match(edge, /aora_evaluate_shift_rules/);
assert.match(edge, /aora_decide_shift_preference/);
assert.match(migration, /enable row level security/);
assert.match(migration, /revoke all on table public\.aora_shift_preferences/);
assert.match(migration, /for update/);
assert.match(migration, /revision_conflict/);
assert.match(migration, /update public\.workspace_snapshots as ws/);
assert.match(migration, /ws\.revision = p_expected_revision/);
assert.match(migration, /sourcePreferenceId/);
console.log("shift preference source contract: ok");
