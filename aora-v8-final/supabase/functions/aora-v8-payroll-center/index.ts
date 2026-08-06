import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import { PDFDocument, StandardFonts, rgb } from "npm:pdf-lib@1.17.1";
import { strToU8, zipSync } from "npm:fflate@0.8.2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const service = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const FUNCTION_VERSION = "2026-08-06.1";
const EXPORT_SCHEMA_VERSION = "aora-payroll-export/1.0";
const EXPORT_BUCKET = "payroll-exports";
const DEFAULT_ORIGIN = "https://dopamine-mobins-projects-4f428afa.vercel.app";
const TEAM_SUFFIX = "-mobins-projects-4f428afa.vercel.app";
const EXACT_ORIGINS = new Set([
  DEFAULT_ORIGIN,
  "https://dopamine-blond.vercel.app",
  "https://aora-v8-hardening.vercel.app",
  "https://aora-v8-final.vercel.app",
  "https://aora-workforce.vercel.app",
]);
const MAX_BODY_BYTES = 1_500_000;
const LINE_TYPES = ["regular", "night", "sunday", "holiday", "vacation", "sickness", "correction"];
const DEFAULT_LABELS = {
  regular: "Arbeitsstunden",
  night: "Nachtstunden",
  sunday: "Sonntagsstunden",
  holiday: "Feiertagsstunden",
  vacation: "Urlaub",
  sickness: "Krankheit",
  correction: "Korrektur",
};

function localHost(hostname) {
  const host = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  return ["localhost", "0.0.0.0", "::1"].includes(host) || /^127(?:\.\d{1,3}){3}$/.test(host);
}
function originAllowed(origin) {
  if (!origin || origin === "null") return true;
  try {
    const parsed = new URL(origin);
    return EXACT_ORIGINS.has(parsed.origin) ||
      (parsed.protocol === "https:" && parsed.hostname.endsWith(TEAM_SUFFIX)) ||
      (parsed.protocol === "http:" && localHost(parsed.hostname));
  } catch {
    return false;
  }
}
function cors(origin) {
  return {
    "Access-Control-Allow-Origin": origin && originAllowed(origin) ? origin : DEFAULT_ORIGIN,
    "Access-Control-Allow-Headers": "content-type,authorization,apikey",
    "Access-Control-Allow-Methods": "POST,OPTIONS",
    "Access-Control-Expose-Headers": "content-disposition,x-export-checksum,x-export-id",
    "Access-Control-Max-Age": "600",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    Vary: "Origin",
  };
}
function json(body, status = 200, origin = null) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors(origin), "Content-Type": "application/json; charset=utf-8" } });
}
function fail(message, status = 400) {
  throw Object.assign(new Error(message), { status });
}
function clean(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}
function safeEmail(value) {
  const email = clean(value).toLowerCase();
  if (!email) return null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail("Bitte eine gültige E-Mail-Adresse eingeben.");
  return email;
}
function int(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.round(parsed) : fallback;
}
function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.keys(value).sort().reduce((result, key) => {
      result[key] = stableValue(value[key]);
      return result;
    }, {});
  }
  return value;
}
function stableStringify(value) {
  return JSON.stringify(stableValue(value));
}
async function sha256Bytes(bytes) {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest)).map(part => part.toString(16).padStart(2, "0")).join("");
}
async function sha256Text(value) {
  return sha256Bytes(new TextEncoder().encode(value));
}
function filenamePart(value) {
  return clean(value).normalize("NFKD").replace(/[^a-zA-Z0-9._-]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 80) || "Export";
}
function csvValue(value) {
  let text = String(value ?? "");
  if (/^[=+@]/.test(text) || /^-[^0-9]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}
function csv(rows) {
  return `\uFEFF${rows.map(row => row.map(csvValue).join(";")).join("\r\n")}\r\n`;
}
function xml(value) {
  return String(value ?? "").replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" }[character]));
}
function columnName(index) {
  let value = index + 1;
  let name = "";
  while (value > 0) {
    const remainder = (value - 1) % 26;
    name = String.fromCharCode(65 + remainder) + name;
    value = Math.floor((value - 1) / 26);
  }
  return name;
}
function worksheetXml(rows, widths) {
  const sheetRows = rows.map((row, rowIndex) => {
    const cells = row.map((value, columnIndex) => {
      const reference = `${columnName(columnIndex)}${rowIndex + 1}`;
      const style = rowIndex === 0 ? 1 : 0;
      if (typeof value === "number" && Number.isFinite(value)) return `<c r="${reference}" s="${style}"><v>${value}</v></c>`;
      return `<c r="${reference}" t="inlineStr" s="${style}"><is><t xml:space="preserve">${xml(value)}</t></is></c>`;
    }).join("");
    return `<row r="${rowIndex + 1}">${cells}</row>`;
  }).join("");
  const columns = widths.map((width, index) => `<col min="${index + 1}" max="${index + 1}" width="${width}" customWidth="1"/>`).join("");
  const lastColumn = columnName(Math.max(0, widths.length - 1));
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="A1:${lastColumn}${Math.max(1, rows.length)}"/><sheetViews><sheetView workbookViewId="0"/></sheetViews><cols>${columns}</cols><sheetData>${sheetRows}</sheetData><autoFilter ref="A1:${lastColumn}${Math.max(1, rows.length)}"/><pageMargins left="0.4" right="0.4" top="0.5" bottom="0.5" header="0.2" footer="0.2"/></worksheet>`;
}
function xlsxBytes(sheets) {
  const sheetNames = Object.keys(sheets);
  const overrides = sheetNames.map((_, index) => `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("");
  const workbookSheets = sheetNames.map((name, index) => `<sheet name="${xml(name.slice(0, 31))}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`).join("");
  const rels = sheetNames.map((_, index) => `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`).join("");
  const files = {
    "[Content_Types].xml": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${overrides}<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`),
    "_rels/.rels": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`),
    "xl/workbook.xml": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${workbookSheets}</sheets></workbook>`),
    "xl/_rels/workbook.xml.rels": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels}<Relationship Id="rId${sheetNames.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`),
    "xl/styles.xml": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="10"/><name val="Arial"/></font><font><b/><sz val="10"/><color rgb="FFFFFFFF"/><name val="Arial"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF1B1B1B"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFill="1" applyFont="1" applyAlignment="1"><alignment vertical="center"/></xf></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`),
  };
  sheetNames.forEach((name, index) => {
    const sheet = sheets[name];
    files[`xl/worksheets/sheet${index + 1}.xml`] = strToU8(worksheetXml(sheet.rows, sheet.widths));
  });
  return zipSync(files, { level: 6 });
}

function monthBounds(year, month) {
  const y = int(year);
  const m = int(month);
  if (y < 2000 || y > 2200 || m < 1 || m > 12) fail("Ungültiger Abrechnungsmonat.");
  const from = `${y}-${String(m).padStart(2, "0")}-01`;
  const to = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
  return { year: y, month: m, from, to, key: `${y}-${String(m).padStart(2, "0")}` };
}
function enumerateDates(from, to) {
  const dates = [];
  const cursor = new Date(`${from}T12:00:00Z`);
  const end = new Date(`${to}T12:00:00Z`);
  while (cursor <= end && dates.length < 370) {
    dates.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return dates;
}
function weekdayIndex(date) {
  const day = new Date(`${date}T12:00:00Z`).getUTCDay();
  return day === 0 ? 6 : day - 1;
}
function scheduleMinutes(schedule, date) {
  if (!schedule) return 0;
  const keys = ["monday_minutes", "tuesday_minutes", "wednesday_minutes", "thursday_minutes", "friday_minutes", "saturday_minutes", "sunday_minutes"];
  return Math.max(0, int(schedule[keys[weekdayIndex(date)]]));
}
function berlinParts(value) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Berlin",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date(value));
  const map = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return { date: `${map.year}-${map.month}-${map.day}`, hour: Number(map.hour === "24" ? 0 : map.hour), weekday: map.weekday };
}
function minuteBuckets(startValue, endValue, breakMinutes) {
  const start = new Date(startValue).getTime();
  const end = new Date(endValue).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return { total: 0, night: 0, sunday: 0 };
  const gross = Math.max(0, Math.floor((end - start) / 60000));
  const net = Math.max(0, gross - Math.max(0, int(breakMinutes)));
  let night = 0;
  let sunday = 0;
  for (let i = 0; i < net; i += 1) {
    const local = berlinParts(start + i * 60000);
    if (local.hour >= 20 || local.hour < 6) night += 1;
    if (local.weekday === "Sun") sunday += 1;
  }
  return { total: net, night, sunday };
}
function absenceType(row) {
  const payload = row.payload || {};
  const raw = clean(payload.type || payload.kind || payload.reason || row.status || "").toLowerCase();
  if (/urlaub|vacation|holiday/.test(raw)) return "vacation";
  if (/krank|sick|ill/.test(raw)) return "sickness";
  return null;
}
function isApprovedAbsence(row) {
  return ["approved", "accepted", "confirmed"].includes(clean(row.status).toLowerCase());
}
function mergeEmployee(row) {
  const payload = row.payload || {};
  return {
    ...payload,
    ...row,
    id: String(row.id),
    name: clean(row.name || payload.name || "Mitarbeiter/in"),
    locationId: String(row.primary_location_id || row.location_id || payload.primaryLocationId || payload.locationId || ""),
    weeklyTargetMinutes: int(row.weekly_target_minutes || payload.weeklyTargetMinutes || 0),
  };
}
function employeeDisplayName(employeeId, employeeMap) {
  return employeeMap.get(String(employeeId))?.name || String(employeeId);
}

async function context(token) {
  if (String(token).length !== 64) fail("Sitzungstoken fehlt.", 401);
  const { data: sessions, error } = await service.rpc("validate_demo_session", { p_token: String(token) });
  if (error || !sessions?.length) fail("Sitzung ist ungültig oder abgelaufen.", 401);
  const session = sessions[0];
  const { data: organization } = await service.from("organizations")
    .select("id,slug,name,status,timezone")
    .eq("id", session.organization_id)
    .eq("status", "active")
    .single();
  if (!organization) fail("Organisation ist nicht aktiv.", 403);
  const { data: snapshot } = await service.from("workspace_snapshots")
    .select("state,revision")
    .eq("organization_id", organization.id)
    .single();
  if (!snapshot) fail("Arbeitsbereich wurde nicht gefunden.", 404);
  const state = structuredClone(snapshot.state || {});
  const admins = Array.isArray(state.admins) ? state.admins : [];
  const admin = session.role === "admin"
    ? admins.find(item => item.id === session.subject_id && item.active !== false && item.status !== "revoked")
    : null;
  const accessRole = admin ? (admin.scope === "owner" ? "owner" : "manager") : session.role;
  let locationIds = [];
  if (accessRole === "owner") {
    locationIds = (Array.isArray(state.locations) ? state.locations : []).filter(item => item.active !== false).map(item => String(item.id));
  }
  if (accessRole === "manager") {
    const { data: rows } = await service.from("manager_location_access")
      .select("location_id")
      .eq("organization_id", organization.id)
      .eq("manager_id", session.subject_id);
    locationIds = (rows || []).map(row => String(row.location_id));
    if (!locationIds.length) locationIds = (admin?.locationIds || [admin?.locationId]).filter(Boolean).map(String);
  }
  return { session, organization, snapshot, state, accessRole, locationIds };
}
function requireManager(ctx) {
  if (!["owner", "manager"].includes(ctx.accessRole)) fail("Manager-Zugang erforderlich.", 403);
}
async function scopedEmployees(ctx) {
  const { data, error } = await service.from("employees")
    .select("*")
    .eq("organization_id", ctx.organization.id)
    .eq("active", true)
    .is("deleted_at", null)
    .order("name", { ascending: true });
  if (error) throw error;
  const employees = (data || []).map(mergeEmployee);
  if (ctx.accessRole !== "manager") return employees;
  const allowed = new Set(ctx.locationIds.map(String));
  return employees.filter(employee => allowed.has(String(employee.locationId || "")));
}
async function audit(ctx, action, entityId, payload = {}) {
  await service.from("audit_logs").insert({
    organization_id: ctx.organization.id,
    id: crypto.randomUUID(),
    action,
    actor: ctx.session.subject_id,
    actor_type: ctx.accessRole,
    actor_id: ctx.session.subject_id,
    entity: "payroll",
    entity_type: "payroll",
    entity_id: String(entityId),
    created_at: new Date().toISOString(),
    payload,
    metadata: { source: "aora-v8-payroll-center", functionVersion: FUNCTION_VERSION },
  });
}

async function loadOverview(ctx) {
  requireManager(ctx);
  const employees = await scopedEmployees(ctx);
  const employeeIds = employees.map(item => item.id);
  const [{ data: profile }, identitiesResult, schedulesResult, periodsResult, exportsResult, mappingsResult] = await Promise.all([
    service.from("payroll_profiles").select("*").eq("organization_id", ctx.organization.id).maybeSingle(),
    employeeIds.length
      ? service.from("employee_payroll_identities").select("*").eq("organization_id", ctx.organization.id).in("employee_id", employeeIds)
      : Promise.resolve({ data: [], error: null }),
    employeeIds.length
      ? service.from("employment_schedules").select("*").eq("organization_id", ctx.organization.id).in("employee_id", employeeIds).order("valid_from", { ascending: false })
      : Promise.resolve({ data: [], error: null }),
    service.from("payroll_periods").select("id,year,month,version,status,snapshot_hash,closed_at,closed_by")
      .eq("organization_id", ctx.organization.id).order("closed_at", { ascending: false }).limit(24),
    service.from("payroll_exports").select("id,payroll_period_id,format,status,checksum_sha256,row_count,created_at,metadata")
      .eq("organization_id", ctx.organization.id).order("created_at", { ascending: false }).limit(24),
    service.from("wage_type_mappings").select("*").eq("organization_id", ctx.organization.id).order("source_type", { ascending: true }),
  ]);
  for (const result of [identitiesResult, schedulesResult, periodsResult, exportsResult, mappingsResult]) if (result.error) throw result.error;
  const identityMap = new Map((identitiesResult.data || []).map(row => [String(row.employee_id), row]));
  const scheduleMap = new Map();
  for (const row of schedulesResult.data || []) if (!scheduleMap.has(String(row.employee_id))) scheduleMap.set(String(row.employee_id), row);
  return {
    profile: profile || {
      payroll_system: "generic_excel",
      consultant_name: "",
      consultant_email: "",
      holiday_region: "BE",
      cutoff_day: 1,
      settings: {},
      mapping_version: 1,
    },
    employees: employees.map(employee => ({
      ...employee,
      payrollIdentity: identityMap.get(employee.id) || null,
      schedule: scheduleMap.get(employee.id) || null,
    })),
    mappings: mappingsResult.data || [],
    periods: periodsResult.data || [],
    exports: exportsResult.data || [],
    functionVersion: FUNCTION_VERSION,
  };
}

async function saveSetup(ctx, body) {
  requireManager(ctx);
  const payrollSystem = ["generic_excel", "datev_lodas", "datev_lohn_gehalt", "other"].includes(body.profile?.payrollSystem)
    ? body.profile.payrollSystem
    : "generic_excel";
  const profile = {
    organization_id: ctx.organization.id,
    payroll_system: payrollSystem,
    consultant_name: clean(body.profile?.consultantName) || null,
    consultant_email: safeEmail(body.profile?.consultantEmail),
    holiday_region: clean(body.profile?.holidayRegion || "BE").slice(0, 8) || "BE",
    cutoff_day: Math.min(31, Math.max(1, int(body.profile?.cutoffDay, 1))),
    settings: { signatureOptional: true, exportMode: "download", ...(body.profile?.settings || {}) },
    updated_at: new Date().toISOString(),
  };
  const { error: profileError } = await service.from("payroll_profiles").upsert(profile, { onConflict: "organization_id" });
  if (profileError) throw profileError;

  const allowed = new Map((await scopedEmployees(ctx)).map(employee => [employee.id, employee]));
  const employees = Array.isArray(body.employees) ? body.employees : [];
  for (const item of employees) {
    const employeeId = String(item.employeeId || "");
    if (!allowed.has(employeeId)) fail("Ein Mitarbeiter gehört nicht zu deinem Zugriffsbereich.", 403);
    const personnelNumber = clean(item.personnelNumber);
    if (!personnelNumber) fail(`Personalnummer fehlt für ${allowed.get(employeeId).name}.`);
    const identity = {
      organization_id: ctx.organization.id,
      employee_id: employeeId,
      personnel_number: personnelNumber.slice(0, 64),
      cost_center: clean(item.costCenter).slice(0, 64) || null,
      department_code: clean(item.departmentCode).slice(0, 64) || null,
      payroll_group: clean(item.payrollGroup).slice(0, 64) || null,
      valid_from: String(item.validFrom || `${new Date().getUTCFullYear()}-01-01`),
      valid_to: item.validTo || null,
      updated_by: ctx.session.subject_id,
      updated_at: new Date().toISOString(),
    };
    const { error: identityError } = await service.from("employee_payroll_identities").upsert(identity, { onConflict: "organization_id,employee_id" });
    if (identityError) throw identityError;

    const schedule = item.schedule || {};
    const scheduleRow = {
      organization_id: ctx.organization.id,
      employee_id: employeeId,
      valid_from: String(item.validFrom || `${new Date().getUTCFullYear()}-01-01`),
      valid_to: item.validTo || null,
      monday_minutes: Math.max(0, Math.min(1440, int(schedule.mondayMinutes))),
      tuesday_minutes: Math.max(0, Math.min(1440, int(schedule.tuesdayMinutes))),
      wednesday_minutes: Math.max(0, Math.min(1440, int(schedule.wednesdayMinutes))),
      thursday_minutes: Math.max(0, Math.min(1440, int(schedule.thursdayMinutes))),
      friday_minutes: Math.max(0, Math.min(1440, int(schedule.fridayMinutes))),
      saturday_minutes: Math.max(0, Math.min(1440, int(schedule.saturdayMinutes))),
      sunday_minutes: Math.max(0, Math.min(1440, int(schedule.sundayMinutes))),
      updated_by: ctx.session.subject_id,
      updated_at: new Date().toISOString(),
    };
    const weekly = ["monday_minutes", "tuesday_minutes", "wednesday_minutes", "thursday_minutes", "friday_minutes", "saturday_minutes", "sunday_minutes"]
      .reduce((sum, key) => sum + scheduleRow[key], 0);
    if (weekly <= 0) fail(`Arbeitszeitmodell fehlt für ${allowed.get(employeeId).name}.`);
    const { error: scheduleError } = await service.from("employment_schedules").upsert(scheduleRow, { onConflict: "organization_id,employee_id,valid_from" });
    if (scheduleError) throw scheduleError;
  }

  const mappings = Array.isArray(body.mappings) ? body.mappings : [];
  for (const sourceType of LINE_TYPES) {
    const item = mappings.find(row => row.sourceType === sourceType) || {};
    const mapping = {
      organization_id: ctx.organization.id,
      payroll_system: payrollSystem,
      source_type: sourceType,
      external_wage_type: clean(item.externalWageType).slice(0, 64) || null,
      label: clean(item.label || DEFAULT_LABELS[sourceType]).slice(0, 120),
      unit: ["hours", "days", "amount"].includes(item.unit) ? item.unit : "hours",
      rounding_rule: ["minute", "quarter_hour", "hundredth_hour"].includes(item.roundingRule) ? item.roundingRule : "minute",
      valid_from: String(item.validFrom || `${new Date().getUTCFullYear()}-01-01`),
      valid_to: item.validTo || null,
      version: Math.max(1, int(item.version, 1)),
      updated_at: new Date().toISOString(),
    };
    const { error } = await service.from("wage_type_mappings").upsert(mapping, { onConflict: "organization_id,payroll_system,source_type,valid_from" });
    if (error) throw error;
  }
  await audit(ctx, "PAYROLL_SETUP_SAVED", ctx.organization.id, { payrollSystem, employeeCount: employees.length });
  return loadOverview(ctx);
}

async function calculatePreview(ctx, year, month) {
  requireManager(ctx);
  const period = monthBounds(year, month);
  const employees = await scopedEmployees(ctx);
  const employeeIds = employees.map(item => item.id);
  const employeeMap = new Map(employees.map(item => [item.id, item]));
  if (!employeeIds.length) return { period, employees: [], lines: [], exceptions: [], blockers: [], warnings: [], totals: {} };

  const [profileResult, identitiesResult, schedulesResult, mappingsResult, entriesResult, correctionsResult, absencesResult] = await Promise.all([
    service.from("payroll_profiles").select("*").eq("organization_id", ctx.organization.id).maybeSingle(),
    service.from("employee_payroll_identities").select("*").eq("organization_id", ctx.organization.id).in("employee_id", employeeIds),
    service.from("employment_schedules").select("*").eq("organization_id", ctx.organization.id).in("employee_id", employeeIds)
      .lte("valid_from", period.to).or(`valid_to.is.null,valid_to.gte.${period.from}`).order("valid_from", { ascending: false }),
    service.from("wage_type_mappings").select("*").eq("organization_id", ctx.organization.id),
    service.from("time_entries").select("*").eq("organization_id", ctx.organization.id).in("employee_id", employeeIds)
      .gte("entry_date", period.from).lte("entry_date", period.to).is("deleted_at", null),
    service.from("time_entry_corrections").select("id,employee_id,time_entry_id,status,reason,requested_at")
      .eq("organization_id", ctx.organization.id).in("employee_id", employeeIds).eq("status", "pending"),
    service.from("leave_requests").select("*").eq("organization_id", ctx.organization.id).in("employee_id", employeeIds)
      .lte("starts_on", period.to).gte("ends_on", period.from),
  ]);
  for (const result of [identitiesResult, schedulesResult, mappingsResult, entriesResult, correctionsResult, absencesResult]) if (result.error) throw result.error;

  const profile = profileResult.data || { payroll_system: "generic_excel", holiday_region: "BE", settings: {} };
  const identityMap = new Map((identitiesResult.data || []).map(row => [String(row.employee_id), row]));
  const schedulesByEmployee = new Map();
  for (const row of schedulesResult.data || []) {
    const id = String(row.employee_id);
    if (!schedulesByEmployee.has(id)) schedulesByEmployee.set(id, []);
    schedulesByEmployee.get(id).push(row);
  }
  const mappingMap = new Map();
  for (const row of mappingsResult.data || []) {
    if (row.payroll_system === profile.payroll_system && !mappingMap.has(row.source_type)) mappingMap.set(row.source_type, row);
  }
  const entriesByEmployee = new Map();
  for (const row of entriesResult.data || []) {
    const id = String(row.employee_id);
    if (!entriesByEmployee.has(id)) entriesByEmployee.set(id, []);
    entriesByEmployee.get(id).push(row);
  }
  const absencesByEmployee = new Map();
  for (const row of absencesResult.data || []) {
    const id = String(row.employee_id);
    if (!absencesByEmployee.has(id)) absencesByEmployee.set(id, []);
    absencesByEmployee.get(id).push(row);
  }

  const lines = [];
  const exceptions = [];
  const employeeResults = [];
  const addException = (employeeId, code, severity, message, sourceEntityType = null, sourceEntityId = null, payload = {}) => {
    exceptions.push({ employeeId, code, severity, message, sourceEntityType, sourceEntityId, payload });
  };
  if (!profileResult.data) addException(null, "PAYROLL_PROFILE_MISSING", "blocker", "Die Lohnvorbereitung ist noch nicht eingerichtet.");
  if (!clean(profile.holiday_region)) addException(null, "HOLIDAY_REGION_MISSING", "warning", "Bundesland für Feiertage ist nicht hinterlegt. Feiertagszuschläge werden nicht automatisch erzeugt.");
  if (["datev_lodas", "datev_lohn_gehalt"].includes(profile.payroll_system)) {
    for (const type of ["regular", "night", "sunday", "holiday", "vacation", "sickness"]) {
      if (!clean(mappingMap.get(type)?.external_wage_type)) addException(null, `WAGE_TYPE_${type.toUpperCase()}_MISSING`, "blocker", `DATEV-Lohnart fehlt für ${DEFAULT_LABELS[type]}.`);
    }
  }

  for (const correction of correctionsResult.data || []) {
    addException(String(correction.employee_id), "PENDING_CORRECTION", "blocker", `Offene Zeitkorrektur für ${employeeDisplayName(correction.employee_id, employeeMap)}.`, "time_entry_correction", correction.id, { reason: correction.reason });
  }

  for (const employee of employees) {
    const employeeId = employee.id;
    const identity = identityMap.get(employeeId);
    const scheduleRows = schedulesByEmployee.get(employeeId) || [];
    const schedule = scheduleRows.find(row => row.valid_from <= period.to && (!row.valid_to || row.valid_to >= period.from)) || null;
    const employeeLinesStart = lines.length;
    if (!identity?.personnel_number) addException(employeeId, "PERSONNEL_NUMBER_MISSING", "blocker", `Personalnummer fehlt für ${employee.name}.`, "employee", employeeId);
    if (!schedule) addException(employeeId, "SCHEDULE_MISSING", "blocker", `Arbeitszeitmodell fehlt für ${employee.name}.`, "employee", employeeId);

    let worked = 0;
    let night = 0;
    let sunday = 0;
    let credited = 0;
    const entries = entriesByEmployee.get(employeeId) || [];
    for (const entry of entries) {
      const open = !entry.end_time || ["live", "paused"].includes(clean(entry.status).toLowerCase());
      if (open) {
        addException(employeeId, "OPEN_TIME_ENTRY", "blocker", `Offene Stempelung am ${entry.entry_date} für ${employee.name}.`, "time_entry", entry.id);
        continue;
      }
      const buckets = minuteBuckets(entry.start_time, entry.end_time, entry.break_minutes);
      const total = int(entry.duration_minutes) > 0 ? int(entry.duration_minutes) : buckets.total;
      if (total <= 0) {
        addException(employeeId, "INVALID_DURATION", "blocker", `Ungültige Arbeitsdauer am ${entry.entry_date} für ${employee.name}.`, "time_entry", entry.id);
        continue;
      }
      const costCenter = identity?.cost_center || null;
      const regularMap = mappingMap.get("regular");
      lines.push({ employeeId, workDate: entry.entry_date, sourceEntryId: entry.id, lineType: "regular", minutes: total, days: 0, externalWageType: regularMap?.external_wage_type || null, costCenter, payload: { source: entry.source || "time_entry" } });
      worked += total;
      if (buckets.night > 0) {
        const map = mappingMap.get("night");
        lines.push({ employeeId, workDate: entry.entry_date, sourceEntryId: entry.id, lineType: "night", minutes: buckets.night, days: 0, externalWageType: map?.external_wage_type || null, costCenter, payload: { additive: true } });
        night += buckets.night;
      }
      if (buckets.sunday > 0) {
        const map = mappingMap.get("sunday");
        lines.push({ employeeId, workDate: entry.entry_date, sourceEntryId: entry.id, lineType: "sunday", minutes: buckets.sunday, days: 0, externalWageType: map?.external_wage_type || null, costCenter, payload: { additive: true } });
        sunday += buckets.sunday;
      }
    }

    for (const absence of absencesByEmployee.get(employeeId) || []) {
      if (!isApprovedAbsence(absence)) continue;
      const type = absenceType(absence);
      if (!type || !schedule) continue;
      const start = String(absence.starts_on || period.from);
      const end = String(absence.ends_on || start);
      for (const date of enumerateDates(start < period.from ? period.from : start, end > period.to ? period.to : end)) {
        const minutes = scheduleMinutes(schedule, date);
        if (minutes <= 0) continue;
        const map = mappingMap.get(type);
        lines.push({ employeeId, workDate: date, sourceEntryId: absence.id, lineType: type, minutes, days: 1, externalWageType: map?.external_wage_type || null, costCenter: identity?.cost_center || null, payload: { absenceStatus: absence.status } });
        credited += minutes;
      }
    }

    const planned = schedule ? enumerateDates(period.from, period.to).reduce((sum, date) => sum + scheduleMinutes(schedule, date), 0) : 0;
    employeeResults.push({
      id: employeeId,
      name: employee.name,
      locationId: employee.locationId,
      personnelNumber: identity?.personnel_number || "",
      costCenter: identity?.cost_center || "",
      plannedMinutes: planned,
      workedMinutes: worked,
      creditedMinutes: credited,
      totalMinutes: worked + credited,
      differenceMinutes: worked + credited - planned,
      nightMinutes: night,
      sundayMinutes: sunday,
      lineCount: lines.length - employeeLinesStart,
      blockerCount: exceptions.filter(item => item.employeeId === employeeId && item.severity === "blocker").length,
      warningCount: exceptions.filter(item => item.employeeId === employeeId && item.severity === "warning").length,
    });
  }

  const totals = employeeResults.reduce((result, item) => {
    result.plannedMinutes += item.plannedMinutes;
    result.workedMinutes += item.workedMinutes;
    result.creditedMinutes += item.creditedMinutes;
    result.totalMinutes += item.totalMinutes;
    result.differenceMinutes += item.differenceMinutes;
    result.nightMinutes += item.nightMinutes;
    result.sundayMinutes += item.sundayMinutes;
    return result;
  }, { plannedMinutes: 0, workedMinutes: 0, creditedMinutes: 0, totalMinutes: 0, differenceMinutes: 0, nightMinutes: 0, sundayMinutes: 0 });

  const blockers = exceptions.filter(item => item.severity === "blocker");
  const warnings = exceptions.filter(item => item.severity === "warning");
  return {
    period,
    profile,
    employees: employeeResults,
    lines,
    exceptions,
    blockers,
    warnings,
    totals,
    status: blockers.length ? "blocked" : warnings.length ? "warning" : "ready",
    calculatedAt: new Date().toISOString(),
    sourceRevision: ctx.snapshot.revision,
    functionVersion: FUNCTION_VERSION,
  };
}

async function closePeriod(ctx, body) {
  const preview = await calculatePreview(ctx, body.year, body.month);
  if (preview.blockers.length) fail(`Der Monat kann noch nicht abgeschlossen werden. ${preview.blockers.length} Blocker müssen zuerst gelöst werden.`, 409);
  const snapshot = {
    schemaVersion: EXPORT_SCHEMA_VERSION,
    organization: { id: ctx.organization.id, name: clean(ctx.state.company?.name || ctx.organization.name) },
    period: preview.period,
    profile: {
      payrollSystem: preview.profile.payroll_system,
      holidayRegion: preview.profile.holiday_region,
      consultantName: preview.profile.consultant_name,
      consultantEmail: preview.profile.consultant_email,
      mappingVersion: preview.profile.mapping_version,
    },
    employees: preview.employees,
    totals: preview.totals,
    lines: preview.lines,
    exceptions: preview.exceptions,
    sourceRevision: preview.sourceRevision,
    calculatedAt: preview.calculatedAt,
    closedAt: new Date().toISOString(),
    closedBy: ctx.session.subject_id,
  };
  const snapshotHash = await sha256Text(stableStringify(snapshot));
  const { data, error } = await service.rpc("aora_close_payroll_period_atomic", {
    p_organization_id: ctx.organization.id,
    p_year: preview.period.year,
    p_month: preview.period.month,
    p_actor_id: ctx.session.subject_id,
    p_snapshot_hash: snapshotHash,
    p_snapshot: snapshot,
    p_lines: preview.lines,
    p_exceptions: preview.exceptions,
  });
  if (error) throw error;
  const row = data?.[0];
  return { periodId: row?.period_id, version: row?.period_version, snapshotHash, preview };
}

function lineLabel(type, mappings) {
  return mappings.get(type)?.label || DEFAULT_LABELS[type] || type;
}
function hours(minutes) {
  return (Math.round((Number(minutes) || 0) / 6) / 10).toFixed(2).replace(".", ",");
}
function displayDate(value) {
  if (!value) return "";
  return new Intl.DateTimeFormat("de-DE", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "UTC" }).format(new Date(`${value}T12:00:00Z`));
}
function formatMinutes(value) {
  const minutes = int(value);
  const sign = minutes < 0 ? "-" : "";
  const absolute = Math.abs(minutes);
  return `${sign}${String(Math.floor(absolute / 60)).padStart(2, "0")}:${String(absolute % 60).padStart(2, "0")}`;
}
async function pdfReport(period, lines, exceptions, employeeMap, profile) {
  const pdf = await PDFDocument.create();
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const pageSize = [595.28, 841.89];
  let page = pdf.addPage(pageSize);
  let y = 790;
  const left = 42;
  const addPage = () => { page = pdf.addPage(pageSize); y = 790; };
  const write = (text, size = 9, isBold = false, color = rgb(0.12, 0.12, 0.12)) => {
    if (y < 55) addPage();
    page.drawText(String(text).replace(/[^\x20-\x7EäöüÄÖÜß€]/g, " "), { x: left, y, size, font: isBold ? bold : regular, color });
    y -= size + 5;
  };
  write("Aora Lohnvorbereitung", 18, true);
  write(`${String(period.year)}-${String(period.month).padStart(2, "0")} · Version ${period.version}`, 11, true);
  write(`System: ${profile.payroll_system} · Erstellt: ${new Date().toLocaleString("de-DE", { timeZone: "Europe/Berlin" })}`, 8);
  y -= 8;
  write("Zusammenfassung je Mitarbeiter", 12, true);
  const grouped = new Map();
  for (const line of lines) {
    if (!grouped.has(line.employee_id)) grouped.set(line.employee_id, { regular: 0, night: 0, sunday: 0, vacation: 0, sickness: 0 });
    grouped.get(line.employee_id)[line.line_type] = (grouped.get(line.employee_id)[line.line_type] || 0) + int(line.minutes);
  }
  for (const [employeeId, values] of grouped) {
    write(`${employeeMap.get(String(employeeId))?.name || employeeId} · Arbeit ${formatMinutes(values.regular)} · Nacht ${formatMinutes(values.night)} · Sonntag ${formatMinutes(values.sunday)} · Urlaub ${formatMinutes(values.vacation)} · Krankheit ${formatMinutes(values.sickness)}`, 8);
  }
  y -= 8;
  write("Prüfhinweise", 12, true);
  if (!exceptions.length) write("Keine offenen Prüfhinweise in der abgeschlossenen Version.", 9);
  for (const item of exceptions) write(`[${String(item.severity).toUpperCase()}] ${item.message}`, 8, item.severity === "blocker", item.severity === "warning" ? rgb(0.55, 0.3, 0.05) : rgb(0.12, 0.12, 0.12));
  y -= 10;
  write(`Snapshot-Hash: ${period.snapshot_hash}`, 7);
  write("Die Mitarbeiterunterschrift ist optional und nicht Bestandteil dieses Lohnpakets. Signierte Arbeitszeitnachweise bleiben separat verfügbar.", 8);
  return new Uint8Array(await pdf.save());
}

async function createExport(ctx, body) {
  requireManager(ctx);
  const periodId = String(body.periodId || "");
  const { data: period } = await service.from("payroll_periods").select("*")
    .eq("organization_id", ctx.organization.id).eq("id", periodId).maybeSingle();
  if (!period) fail("Abgeschlossener Abrechnungsmonat wurde nicht gefunden.", 404);
  const [{ data: lines, error: lineError }, { data: exceptions, error: exceptionError }, { data: profile }, employees] = await Promise.all([
    service.from("payroll_lines").select("*").eq("organization_id", ctx.organization.id).eq("payroll_period_id", period.id).order("work_date", { ascending: true }),
    service.from("payroll_exceptions").select("*").eq("organization_id", ctx.organization.id).eq("payroll_period_id", period.id),
    service.from("payroll_profiles").select("*").eq("organization_id", ctx.organization.id).maybeSingle(),
    scopedEmployees(ctx),
  ]);
  if (lineError) throw lineError;
  if (exceptionError) throw exceptionError;
  const employeeMap = new Map(employees.map(item => [item.id, item]));
  const employeeIds = [...new Set((lines || []).map(item => String(item.employee_id)))];
  const { data: identities, error: identityError } = employeeIds.length
    ? await service.from("employee_payroll_identities").select("*").eq("organization_id", ctx.organization.id).in("employee_id", employeeIds)
    : { data: [], error: null };
  if (identityError) throw identityError;
  const identityMap = new Map((identities || []).map(item => [String(item.employee_id), item]));
  const { data: mappings, error: mappingError } = await service.from("wage_type_mappings").select("*").eq("organization_id", ctx.organization.id).eq("payroll_system", profile?.payroll_system || "generic_excel");
  if (mappingError) throw mappingError;
  const mappingMap = new Map((mappings || []).map(item => [item.source_type, item]));

  const movementRows = [["Personalnummer", "Abrechnungsmonat", "Datum", "Lohnart", "Bezeichnung", "Einheit", "Menge", "Kostenstelle", "Mitarbeiter", "Quell-ID"]];
  for (const line of lines || []) {
    const identity = identityMap.get(String(line.employee_id));
    movementRows.push([
      identity?.personnel_number || "",
      `${period.year}-${String(period.month).padStart(2, "0")}`,
      line.work_date || "",
      line.external_wage_type || "",
      lineLabel(line.line_type, mappingMap),
      line.days > 0 && ["vacation", "sickness"].includes(line.line_type) ? "Tage" : "Stunden",
      line.days > 0 && ["vacation", "sickness"].includes(line.line_type) ? String(line.days).replace(".", ",") : hours(line.minutes),
      line.cost_center || identity?.cost_center || "",
      employeeMap.get(String(line.employee_id))?.name || line.employee_id,
      line.source_entry_id || "",
    ]);
  }
  const employeeRows = [["Personalnummer", "Mitarbeiter", "Kostenstelle", "Abteilung"]];
  for (const id of employeeIds) {
    const identity = identityMap.get(id);
    employeeRows.push([identity?.personnel_number || "", employeeMap.get(id)?.name || id, identity?.cost_center || "", identity?.department_code || ""]);
  }
  const exceptionRows = [["Schweregrad", "Mitarbeiter", "Code", "Hinweis"]];
  for (const item of exceptions || []) exceptionRows.push([item.severity, employeeMap.get(String(item.employee_id))?.name || item.employee_id || "Unternehmen", item.code, item.message]);
  const xlsx = xlsxBytes({
    Bewegungsdaten: { rows: movementRows, widths: [18, 18, 14, 14, 24, 12, 14, 16, 28, 30] },
    Mitarbeiter: { rows: employeeRows, widths: [18, 30, 18, 22] },
    Prüfbericht: { rows: exceptionRows, widths: [14, 28, 24, 80] },
  });
  const movementCsv = strToU8(csv(movementRows));
  const employeeCsv = strToU8(csv(employeeRows));
  const pdf = await pdfReport(period, lines || [], exceptions || [], employeeMap, profile || { payroll_system: "generic_excel" });
  const fileEntries = [
    { name: "01_Lohnbewegungsdaten.xlsx", mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", bytes: xlsx },
    { name: "02_Lohnbewegungsdaten.csv", mime: "text/csv; charset=utf-8", bytes: movementCsv },
    { name: "03_Mitarbeiter.csv", mime: "text/csv; charset=utf-8", bytes: employeeCsv },
    { name: "04_Pruefbericht.pdf", mime: "application/pdf", bytes: pdf },
  ];
  const manifest = {
    schemaVersion: EXPORT_SCHEMA_VERSION,
    organizationId: ctx.organization.id,
    period: `${period.year}-${String(period.month).padStart(2, "0")}`,
    periodVersion: period.version,
    periodId: period.id,
    snapshotHash: period.snapshot_hash,
    payrollSystem: profile?.payroll_system || "generic_excel",
    generatedAt: new Date().toISOString(),
    generatedBy: ctx.session.subject_id,
    signaturePolicy: "optional-separate-timesheet-document",
    files: [],
  };
  for (const file of fileEntries) manifest.files.push({ name: file.name, mimeType: file.mime, sizeBytes: file.bytes.length, sha256: await sha256Bytes(file.bytes) });
  const manifestBytes = strToU8(JSON.stringify(manifest, null, 2));
  fileEntries.push({ name: "manifest.json", mime: "application/json", bytes: manifestBytes });
  const zipFiles = Object.fromEntries(fileEntries.map(file => [file.name, file.bytes]));
  const packageBytes = zipSync(zipFiles, { level: 6 });
  const checksum = await sha256Bytes(packageBytes);
  const exportId = crypto.randomUUID();
  const periodKey = `${period.year}-${String(period.month).padStart(2, "0")}`;
  const storagePath = `${ctx.organization.id}/${periodKey}/v${period.version}/${exportId}.zip`;
  const { error: uploadError } = await service.storage.from(EXPORT_BUCKET).upload(storagePath, packageBytes, { contentType: "application/zip", upsert: false, cacheControl: "0" });
  if (uploadError) throw uploadError;
  const { error: exportError } = await service.from("payroll_exports").insert({
    id: exportId,
    organization_id: ctx.organization.id,
    payroll_period_id: period.id,
    format: "zip",
    status: "ready",
    schema_version: EXPORT_SCHEMA_VERSION,
    storage_path: storagePath,
    checksum_sha256: checksum,
    row_count: lines?.length || 0,
    created_by: ctx.session.subject_id,
    metadata: { fileCount: fileEntries.length, payrollSystem: profile?.payroll_system || "generic_excel", periodVersion: period.version, period: periodKey },
  });
  if (exportError) {
    await service.storage.from(EXPORT_BUCKET).remove([storagePath]);
    throw exportError;
  }
  const fileRows = [];
  for (const file of fileEntries) fileRows.push({
    organization_id: ctx.organization.id,
    export_id: exportId,
    file_name: file.name,
    mime_type: file.mime,
    size_bytes: file.bytes.length,
    checksum_sha256: await sha256Bytes(file.bytes),
    storage_path: null,
  });
  fileRows.push({ organization_id: ctx.organization.id, export_id: exportId, file_name: `Aora_Lohnvorbereitung_${periodKey}_v${period.version}.zip`, mime_type: "application/zip", size_bytes: packageBytes.length, checksum_sha256: checksum, storage_path: storagePath });
  const { error: fileError } = await service.from("payroll_export_files").insert(fileRows);
  if (fileError) throw fileError;
  await service.from("payroll_periods").update({ status: "exported" }).eq("organization_id", ctx.organization.id).eq("id", period.id);
  await audit(ctx, "PAYROLL_EXPORT_CREATED", exportId, { periodId: period.id, periodVersion: period.version, checksum, rowCount: lines?.length || 0 });
  const filename = `Aora_Lohnvorbereitung_${periodKey}_v${period.version}.zip`;
  return new Response(packageBytes, {
    status: 200,
    headers: {
      ...cors(body.origin || null),
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "X-Export-Checksum": checksum,
      "X-Export-Id": exportId,
    },
  });
}

async function downloadExport(ctx, body, origin) {
  requireManager(ctx);
  const exportId = String(body.exportId || "");
  const { data: row } = await service.from("payroll_exports").select("*")
    .eq("organization_id", ctx.organization.id).eq("id", exportId).eq("status", "ready").maybeSingle();
  if (!row) fail("Export wurde nicht gefunden.", 404);
  const { data: blob, error } = await service.storage.from(EXPORT_BUCKET).download(row.storage_path);
  if (error || !blob) throw error || new Error("Export konnte nicht geladen werden.");
  const bytes = new Uint8Array(await blob.arrayBuffer());
  if (await sha256Bytes(bytes) !== row.checksum_sha256) fail("Export hat die Integritätsprüfung nicht bestanden.", 409);
  const metadata = row.metadata || {};
  const filename = `Aora_Lohnvorbereitung_${metadata.period || "Export"}.zip`;
  await audit(ctx, "PAYROLL_EXPORT_DOWNLOADED", row.id, { checksum: row.checksum_sha256 });
  return new Response(bytes, { status: 200, headers: { ...cors(origin), "Content-Type": "application/zip", "Content-Disposition": `attachment; filename="${filename}"`, "X-Export-Checksum": row.checksum_sha256, "X-Export-Id": row.id } });
}

Deno.serve(async request => {
  const origin = request.headers.get("origin");
  if (request.method === "OPTIONS") return new Response("ok", { headers: cors(origin) });
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405, origin);
  if (!originAllowed(origin)) return json({ error: "Origin not allowed" }, 403, origin);
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > MAX_BODY_BYTES) return json({ error: "Request too large" }, 413, origin);
  let body;
  try { body = JSON.parse(text || "{}"); } catch { return json({ error: "Invalid request" }, 400, origin); }
  try {
    const ctx = await context(body.token);
    const action = String(body.action || "");
    if (action === "overview") return json(await loadOverview(ctx), 200, origin);
    if (action === "saveSetup") return json(await saveSetup(ctx, body), 200, origin);
    if (action === "preview") return json(await calculatePreview(ctx, body.year, body.month), 200, origin);
    if (action === "closePeriod") return json(await closePeriod(ctx, body), 201, origin);
    if (action === "createExport") return await createExport(ctx, { ...body, origin });
    if (action === "downloadExport") return await downloadExport(ctx, body, origin);
    return json({ error: "Unknown action" }, 400, origin);
  } catch (error) {
    console.error("Aora payroll center failed", error);
    return json({ error: error instanceof Error ? error.message : String(error) }, Number(error?.status || 500), origin);
  }
});
