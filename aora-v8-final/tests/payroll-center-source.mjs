import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const files = {
  index: await readFile(new URL("../app/index.html", import.meta.url), "utf8"),
  ui: await readFile(new URL("../app/modules/payroll-center.js", import.meta.url), "utf8"),
  optional: await readFile(new URL("../app/modules/optional-timesheet-signature.js", import.meta.url), "utf8"),
  payrollFunction: await readFile(new URL("../supabase/functions/aora-v8-payroll-center/index.ts", import.meta.url), "utf8"),
  optionalFunction: await readFile(new URL("../supabase/functions/aora-v8-timesheet-optional-approval/index.ts", import.meta.url), "utf8"),
  migration: await readFile(new URL("../supabase/migrations/20260806011500_aora_payroll_center_foundation.sql", import.meta.url), "utf8"),
};

assert.match(files.index, /payroll-center\.css/);
assert.match(files.index, /optional-timesheet-signature\.js/);
assert.match(files.index, /payroll-center\.js/);
assert.match(files.ui, /Lohnvorbereitung/);
assert.match(files.ui, /Bestehende Arbeitszeiten bleiben unverändert/);
assert.match(files.ui, /Unterschrift bleibt erhalten/);
assert.match(files.optional, /Ohne Unterschrift bestätigen/);
assert.match(files.optional, /Mit Unterschrift bestätigen/);
assert.match(files.payrollFunction, /aora_close_payroll_period_atomic/);
assert.match(files.payrollFunction, /payroll-exports/);
assert.match(files.payrollFunction, /manifest\.json/);
assert.match(files.optionalFunction, /TIMESHEET_ACKNOWLEDGED_WITHOUT_SIGNATURE/);
assert.match(files.optionalFunction, /approval_method\s*:\s*"acknowledgement"/);
assert.match(files.migration, /Additive only/);
assert.match(files.migration, /create table if not exists public\.payroll_periods/);
assert.match(files.migration, /add column if not exists approval_method/);
assert.doesNotMatch(files.migration, /\bdrop\s+table\b/i);
assert.doesNotMatch(files.migration, /\btruncate\b/i);
assert.doesNotMatch(files.migration, /\bdelete\s+from\s+public\.(employees|time_entries|timesheet_submissions|workspace_snapshots)\b/i);

console.log("Aora payroll center source contract passed.");