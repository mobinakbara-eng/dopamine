import fs from 'node:fs';
import assert from 'node:assert/strict';

const ui=fs.readFileSync(new URL('../app/modules/pruefung-export-center.js',import.meta.url),'utf8');
const css=fs.readFileSync(new URL('../app/pruefung-export-center.css',import.meta.url),'utf8');
const edge=fs.readFileSync(new URL('../supabase/functions/aora-v8-datev-hours-export/index.ts',import.meta.url),'utf8');
const migration=fs.readFileSync(new URL('../supabase/migrations/20260821181000_aora_datev_hours_export.sql',import.meta.url),'utf8');
const index=fs.readFileSync(new URL('../app/index.html',import.meta.url),'utf8');

// Prüfung & Exporte becomes the single manager home for DATEV hours and employee signatures.
assert.match(ui,/Prüfung & Exporte/);
assert.match(ui,/legacy\)\{legacy\[0\]=VIEW;legacy\[1\]="Prüfung & Exporte"/);
assert.match(ui,/Nachweise prüfen und Unterschrift anfordern/);
assert.match(ui,/const signingMarkup=previousAdminView\(\)/);
assert.match(css,/data-tab="documents"/);
assert.match(css,/docsign-button-group\{display:none!important\}/);

// The visible technical export choice is intentionally only the DATEV hours file.
assert.match(ui,/DATEV Stundenexport \(\.txt\)/);
assert.match(ui,/Keine Audit-JSONs, keine allgemeinen CSV-Exporte/);
assert.doesNotMatch(ui,/Steuerberater CSV|Audit JSON|CSV Arbeitszeit|PDF Prüfprotokoll/);

// DATEV LODAS output is based on the official standard movement-data booking contract.
assert.match(edge,/Ziel=LODAS/);
assert.match(edge,/u_lod_bwd_buchung_standard/);
assert.match(edge,/abrechnung_zeitraum#bwd;bs_wert_butab#bwd;bs_nr#bwd;la_eigene#bwd;pnr#bwd/);
assert.match(edge,/;01;\$\{settings\.regular_wage_type\};\$\{row\.personnel\};/);
assert.match(edge,/\.join\("\\r\\n"\)/);
assert.match(edge,/MAX_EXPORT_BYTES = 3 \* 1024 \* 1024/);
assert.match(edge,/datev_hours_open_entries/);
assert.match(edge,/datev_personnel_number_missing/);
assert.match(edge,/duplicate_personnel_number/);

// No DATEV Lohnart is guessed: it must be supplied and validated by the employer/adviser mapping.
assert.match(edge,/regular_wage_type text not null|regularWageType/);
assert.doesNotMatch(edge,/regularWageType\s*[:=]\s*["']\d+["']/);
assert.match(ui,/Vom Steuerberater/);

// Mapping and export evidence stay server-owned and inaccessible directly from browser roles.
assert.match(migration,/datev_hours_export_settings/);
assert.match(migration,/datev_hours_employee_mappings/);
assert.match(migration,/datev_hours_export_runs/);
assert.match(migration,/revoke all on table public\.datev_hours_export_settings from anon, authenticated/);
assert.match(edge,/datev_hours_export_runs/);
assert.match(edge,/checksum_sha256/);

// New assets load after the signing/worktime stack and before generic click handlers.
assert.match(index,/pruefung-export-center\.css/);
assert.match(index,/timesheet-current-period-guard\.js[\s\S]*pruefung-export-center\.js[\s\S]*modules\/handlers\.js/);

console.log('Prüfung, DATEV hours export and signing source contracts passed.');
