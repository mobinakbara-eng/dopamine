import fs from 'node:fs';
import assert from 'node:assert/strict';

const ui=fs.readFileSync(new URL('../app/modules/pruefung-export-center.js',import.meta.url),'utf8');
const css=fs.readFileSync(new URL('../app/pruefung-export-center.css',import.meta.url),'utf8');
const edge=fs.readFileSync(new URL('../supabase/functions/aora-v8-datev-hours-export/index.ts',import.meta.url),'utf8');
const migration=fs.readFileSync(new URL('../supabase/migrations/20260821191000_aora_datev_hours_export_prod.sql',import.meta.url),'utf8');
const tightenMigration=fs.readFileSync(new URL('../supabase/migrations/20260821211500_tighten_datev_lodas_personnel_number.sql',import.meta.url),'utf8');
const index=fs.readFileSync(new URL('../app/index.html',import.meta.url),'utf8');

// Prüfung & Exporte is the single manager entry for DATEV hours and employee signatures.
assert.match(ui,/Prüfung & Exporte/);
assert.match(ui,/compliance\)\{compliance\[0\]=SIGNING_VIEW;compliance\[1\]="Prüfung & Exporte"/);
assert.match(ui,/Arbeitszeitnachweise & Unterschriften/);
assert.match(ui,/previousAdminView\(\)/);
assert.match(css,/data-tab="documents"/);

// Compact mode hides unsigned export clutter, but confirmed signed downloads must stay visible.
assert.match(css,/docsign-button-group\{display:none!important\}/);
assert.match(css,/docsign-button-group:has\(\[data-signed="true"\]\)\{display:flex!important\}/);
assert.match(css,/docsign-button-group:has\(\[data-signed="true"\]\) \[data-signed="false"\]\{display:none!important\}/);

// DATEV setup is writable by owner and manager accounts; employee/kiosk access stays excluded in context.
assert.match(edge,/canConfigure:\["owner","manager"\]\.includes\(ctx\.accessRole\)/);
assert.match(edge,/function requireManager\(ctx:any\)/);
assert.match(edge,/async function saveConfig\(ctx:any,body:any\)\{\s*requireManager\(ctx\)/);
assert.doesNotMatch(edge,/requireOwner\(/);
assert.match(edge,/if\(!\["owner","manager"\]\.includes\(accessRole\)\)fail\("Export-Berechtigung fehlt\./);

// The visible technical export is intentionally only the DATEV hours file.
assert.match(ui,/DATEV-Datei \(\.txt\)/);
assert.match(ui,/Keine internen IDs, Audit-Felder oder technischen Spalten/);
assert.doesNotMatch(ui,/CSV Arbeitszeit|Audit JSON|Steuerberater CSV|PDF Prüfprotokoll/);

// DATEV LODAS movement-data output: monthly hours, booking key, configured wage type and personnel number.
assert.match(edge,/Ziel=LODAS/);
assert.match(edge,/u_lod_bwd_buchung_standard/);
assert.match(edge,/abrechnung_zeitraum#bwd;bs_wert_butab#bwd;bs_nr#bwd;la_eigene#bwd;pnr#bwd/);
assert.match(edge,/;01;\$\{settings\.regular_wage_type\};\$\{row\.personnel\};/);
assert.match(edge,/\.join\("\\r\\n"\)/);
assert.match(edge,/MAX_EXPORT_BYTES=3\*1024\*1024/);
assert.match(edge,/datev_hours_open_entries/);
assert.match(edge,/datev_personnel_number_missing/);
assert.match(edge,/duplicate_personnel_number/);

// LODAS personnel numbers are constrained to 1..99999 at UI, API and DB layers.
assert.match(ui,/pattern="\[0-9\]\{1,5\}" maxlength="5"/);
assert.match(ui,/1–99999/);
assert.match(edge,/function datevPersonnelNumber\(value:unknown\)/);
assert.match(edge,/digits\(value,1,5,"Personalnummer"\)/);
assert.match(edge,/numeric<1\|\|numeric>99999/);
assert.match(edge,/datevPersonnelNumber\(row\.personnel_number\)/);
assert.match(tightenMigration,/personnel_number ~ '\^\\d\{1,5\}\$'/);
assert.match(tightenMigration,/between 1 and 99999/);

// AORA must never claim actual DATEV validation before a successful real test import.
assert.match(edge,/validationStatus:"not_test_imported"/);
assert.match(edge,/X-Aora-Datev-Validation":"not-test-imported"/);
assert.match(ui,/DATEV-Testimport steht noch aus/);
assert.match(ui,/Testimport in DATEV LODAS noch ausstehend/);

// Manager scope includes cross-location work at accessible locations, with employee-location fallback for older entries.
assert.match(edge,/const explicitLocationId=entryLocationId\(entry\)/);
assert.match(edge,/if\(explicitLocationId\)return ctx\.locationIds\.includes\(explicitLocationId\)/);
assert.match(edge,/employeeLocation\(employeeById\.get\(entryEmployeeId\(entry\)\)\)/);
assert.match(edge,/relevantIds\.has\(employeeId\)/);
assert.match(edge,/if\(!visibleIds\.has\(employeeId\)\)fail\("Mitarbeiter-Zuordnung ist nicht zulässig\./);

// Lohnart is never guessed and obsolete personnel mappings can be removed intentionally.
assert.match(edge,/const regularWageType=digits\(body\.regularWageType/);
assert.doesNotMatch(edge,/regularWageType\s*[:=]\s*["']\d+["']/);
assert.match(ui,/Vom Steuerberater/);
assert.match(edge,/if\(!rawPersonnel\)return\{employeeId,personnelNumber:null/);
assert.match(edge,/from\("datev_hours_employee_mappings"\)\.delete\(\)/);

// DATEV mapping/evidence is isolated from workforce data and inaccessible directly from browser roles.
assert.match(migration,/datev_hours_export_settings/);
assert.match(migration,/datev_hours_employee_mappings/);
assert.match(migration,/datev_hours_export_runs/);
assert.match(migration,/revoke all on table public\.datev_hours_export_settings from anon, authenticated/);
assert.match(edge,/datev_hours_export_runs/);
assert.match(edge,/checksum_sha256/);

// New assets load after the timesheet/worktime stack and before generic click handlers.
assert.match(index,/pruefung-export-center\.css/);
assert.match(index,/timesheet-current-period-guard\.js[\s\S]*pruefung-export-center\.js[\s\S]*modules\/handlers\.js/);

console.log('Prüfung, DATEV hours export and signing source contracts passed.');
