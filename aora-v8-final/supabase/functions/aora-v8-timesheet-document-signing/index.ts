import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import { PDFDocument, StandardFonts, rgb } from "npm:pdf-lib@1.17.1";
import { strToU8, zipSync } from "npm:fflate@0.8.2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const service = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const SIGNATURE_BUCKET = "employee-signatures";
const WORKFLOW_VERSION = "2026-08-04.1";
const CONSENT_VERSION = "2026-08-04.1";
const CONSENT_TEXT = "Ich bestätige, dass ich den angezeigten Arbeitszeitnachweis vollständig geprüft habe. Ich bestätige die darin aufgeführten Arbeitszeiten, Pausen, Abwesenheiten und Korrekturen für den angegebenen Zeitraum. Ich willige ein, dass die jetzt von mir gezeichnete Unterschrift ausschließlich zusammen mit genau dieser Dokumentversion gespeichert und in deren bestätigtem PDF beziehungsweise Excel-Nachweis verwendet wird. Die Unterschrift darf nicht für andere oder zukünftige Dokumente wiederverwendet werden.";
const MAX_BODY_BYTES = 1_500_000;
const DEFAULT_ORIGIN = "https://dopamine-mobins-projects-4f428afa.vercel.app";
const TEAM_SUFFIX = "-mobins-projects-4f428afa.vercel.app";
const EXACT_ORIGINS = new Set([
  DEFAULT_ORIGIN,
  "https://dopamine-blond.vercel.app",
  "https://aora-v8-hardening.vercel.app",
  "https://aora-v8-final.vercel.app",
  "https://aora-workforce.vercel.app",
]);

function localHost(hostname: string) {
  const host = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  return ["localhost", "0.0.0.0", "::1"].includes(host) || /^127(?:\.\d{1,3}){3}$/.test(host);
}
function originAllowed(origin: string | null) {
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
function cors(origin: string | null) {
  return {
    "Access-Control-Allow-Origin": origin && originAllowed(origin) ? origin : DEFAULT_ORIGIN,
    "Access-Control-Allow-Headers": "content-type",
    "Access-Control-Allow-Methods": "POST,OPTIONS",
    "Access-Control-Expose-Headers": "content-disposition,x-document-checksum,x-document-signed",
    "Access-Control-Max-Age": "600",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    Vary: "Origin",
  };
}
function json(body: unknown, status = 200, origin: string | null = null) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors(origin), "Content-Type": "application/json; charset=utf-8" },
  });
}
function fail(message: string, status = 400): never {
  throw Object.assign(new Error(message), { status });
}
function normalizeState(state: any) {
  for (const key of ["admins", "employees", "locations", "timeEntries", "shifts", "leaveRequests"]) {
    if (!Array.isArray(state?.[key])) state[key] = [];
  }
  return state;
}
function normalizeText(value: unknown) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}
function safeDate(value: unknown) {
  const date = String(value || "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) fail("Ungültiges Datum.", 400);
  return date;
}
function dateObject(date: string) {
  return new Date(`${date}T12:00:00Z`);
}
function enumerateDates(from: string, to: string) {
  const dates: string[] = [];
  const cursor = dateObject(from);
  const end = dateObject(to);
  let guard = 0;
  while (cursor <= end && guard < 370) {
    dates.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
    guard += 1;
  }
  if (guard >= 370) fail("Der Zeitraum darf höchstens 369 Tage umfassen.", 400);
  return dates;
}
function timeMinutes(value: unknown) {
  const match = String(value || "").match(/^(\d{1,2}):(\d{2})/);
  return match ? Number(match[1]) * 60 + Number(match[2]) : 0;
}
function durationMinutes(item: any) {
  if (Number.isFinite(Number(item?.durationMinutes)) && Number(item.durationMinutes) > 0) return Number(item.durationMinutes);
  if (!item?.start || !item?.end) return 0;
  const start = timeMinutes(item.start);
  let end = timeMinutes(item.end);
  if (end < start) end += 1440;
  return Math.max(0, end - start - Math.max(0, Number(item.breakMinutes) || 0));
}
function formatMinutes(value: unknown) {
  const minutes = Math.round(Number(value) || 0);
  const sign = minutes < 0 ? "-" : "";
  const abs = Math.abs(minutes);
  return `${sign}${String(Math.floor(abs / 60)).padStart(2, "0")}:${String(abs % 60).padStart(2, "0")}`;
}
function displayDate(value: string) {
  return new Intl.DateTimeFormat("de-DE", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "UTC" }).format(dateObject(value));
}
function canonicalJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalJsonValue);
  if (value && typeof value === "object") {
    const input = value as Record<string, unknown>;
    return Object.keys(input).sort().reduce<Record<string, unknown>>((result, key) => {
      result[key] = canonicalJsonValue(input[key]);
      return result;
    }, {});
  }
  return value;
}
function stableStringify(value: unknown) {
  return JSON.stringify(canonicalJsonValue(value));
}
function externalEmployerName(value: unknown) {
  const name = normalizeText(value);
  return !name || /aora/i.test(name) ? "Arbeitgeber" : name;
}
function filenamePart(value: unknown) {
  return normalizeText(value).normalize("NFKD").replace(/[^a-zA-Z0-9._-]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 80) || "Dokument";
}
function xml(value: unknown) {
  return String(value ?? "").replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" }[character]!));
}
async function sha256Bytes(bytes: Uint8Array) {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest)).map(part => part.toString(16).padStart(2, "0")).join("");
}
async function sha256Text(value: string) {
  return sha256Bytes(new TextEncoder().encode(value));
}
function decodeSignature(dataUrl: string) {
  const match = dataUrl.match(/^data:image\/png;base64,([A-Za-z0-9+/=]+)$/);
  if (!match) fail("Die Unterschrift muss als PNG übertragen werden.", 400);
  let bytes: Uint8Array;
  try {
    const binary = atob(match[1]);
    bytes = Uint8Array.from(binary, character => character.charCodeAt(0));
  } catch {
    fail("Die Unterschrift konnte nicht gelesen werden.", 400);
  }
  if (!bytes! || bytes!.length < 80 || bytes!.length > 1_048_576) fail("Die Unterschrift ist leer oder zu groß.", 400);
  if (Array.from(bytes!.slice(0, 8)).join(",") !== "137,80,78,71,13,10,26,10") fail("Ungültige PNG-Datei.", 400);
  return bytes!;
}

async function context(token: string) {
  if (token.length !== 64) fail("Sitzungstoken fehlt.", 401);
  const { data: sessions, error } = await service.rpc("validate_demo_session", { p_token: token });
  if (error || !sessions?.length) fail("Sitzung ist ungültig oder abgelaufen.", 401);
  const session = sessions[0];
  const { data: org } = await service.from("organizations").select("id,slug,name,status,timezone").eq("id", session.organization_id).eq("status", "active").single();
  if (!org) fail("Organisation ist nicht aktiv.", 403);
  const { data: snapshot } = await service.from("workspace_snapshots").select("state,revision").eq("organization_id", org.id).single();
  if (!snapshot) fail("Arbeitsbereich wurde nicht gefunden.", 404);
  const state = normalizeState(structuredClone(snapshot.state || {}));
  const admin = session.role === "admin" ? state.admins.find((item: any) => item.id === session.subject_id && item.active !== false && item.status !== "revoked") : null;
  const employee = session.role === "employee" ? state.employees.find((item: any) => item.id === session.subject_id && item.active !== false && item.status !== "revoked") : null;
  const accessRole = admin ? (admin.scope === "owner" ? "owner" : "manager") : (employee ? "employee" : session.role);
  let locationIds: string[] = [];
  if (accessRole === "owner") locationIds = state.locations.filter((item: any) => item.active !== false).map((item: any) => String(item.id));
  if (accessRole === "manager") {
    const { data: rows } = await service.from("manager_location_access").select("location_id").eq("organization_id", org.id).eq("manager_id", session.subject_id);
    locationIds = (rows || []).map((row: any) => String(row.location_id));
    if (!locationIds.length) locationIds = (admin?.locationIds || [admin?.locationId]).filter(Boolean).map(String);
  }
  if (accessRole === "employee") {
    const primary = employee?.locationId || employee?.primaryLocationId;
    if (primary) locationIds = [String(primary)];
  }
  return { token, session, org, snapshot, state, admin, employee, accessRole, locationIds };
}
function requireManager(ctx: any) {
  if (!["owner", "manager"].includes(ctx.accessRole)) fail("Manager-Zugang erforderlich.", 403);
}
function requireEmployee(ctx: any) {
  if (ctx.accessRole !== "employee" || !ctx.employee) fail("Mitarbeiter-Zugang erforderlich.", 403);
}
function employeeById(ctx: any, employeeId: string) {
  const employee = ctx.state.employees.find((item: any) => String(item.id) === employeeId && item.active !== false && item.status !== "revoked");
  if (!employee) fail("Mitarbeiter wurde nicht gefunden.", 404);
  const locationId = String(employee.locationId || employee.primaryLocationId || "");
  if (ctx.accessRole === "manager" && !ctx.locationIds.includes(locationId)) fail("Kein Zugriff auf diesen Mitarbeiter.", 403);
  if (ctx.accessRole === "employee" && String(ctx.session.subject_id) !== employeeId) fail("Kein Zugriff auf diesen Mitarbeiter.", 403);
  return { employee, locationId };
}
function locationById(ctx: any, locationId: string) {
  return ctx.state.locations.find((item: any) => String(item.id) === locationId) || { id: locationId, name: "Standort", address: "", city: "" };
}
async function audit(ctx: any, action: string, entityId: string, payload: Record<string, unknown> = {}) {
  await service.from("audit_logs").insert({
    organization_id: ctx.org.id,
    id: crypto.randomUUID(),
    action,
    actor: ctx.session.subject_id,
    actor_type: ctx.accessRole,
    actor_id: ctx.session.subject_id,
    entity: "timesheet_submission",
    entity_type: "timesheet_submission",
    entity_id: entityId,
    created_at: new Date().toISOString(),
    payload,
    metadata: { source: "timesheet-document-signing", workflowVersion: WORKFLOW_VERSION },
  });
}
async function notify(ctx: any, employeeId: string, locationId: string | null, title: string, body: string, submissionId: string) {
  await service.from("notifications").insert({
    organization_id: ctx.org.id,
    id: crypto.randomUUID(),
    employee_id: employeeId,
    location_id: locationId,
    type: "timesheet_approval",
    title,
    body,
    related_entity_type: "timesheet_submission",
    related_entity_id: submissionId,
    read: false,
    created_at: new Date().toISOString(),
    payload: { source: "timesheet-document-signing", workflowVersion: WORKFLOW_VERSION },
  });
}

function leaveRange(item: any) {
  const start = [item.startDate, item.start, item.from, item.startsOn, item.dateFrom, item.date].find(Boolean);
  const end = [item.endDate, item.end, item.to, item.endsOn, item.dateTo, start].find(Boolean);
  return { start: String(start || ""), end: String(end || start || "") };
}
function leaveType(item: any) {
  const kind = String(item.type || item.kind || item.reason || "").toLowerCase();
  if (/urlaub|vacation|holiday/.test(kind)) return "Urlaub";
  if (/krank|sick|ill/.test(kind)) return "Krankheit";
  return "Abwesenheit";
}
function canonicalSnapshot(ctx: any, employee: any, locationId: string, from: string, to: string) {
  const location = locationById(ctx, locationId);
  const entries = ctx.state.timeEntries.filter((item: any) => String(item.employeeId) === String(employee.id) && String(item.date) >= from && String(item.date) <= to);
  const shifts = ctx.state.shifts.filter((item: any) => String(item.employeeId) === String(employee.id) && String(item.date) >= from && String(item.date) <= to);
  const leaves = ctx.state.leaveRequests.filter((item: any) => {
    if (String(item.employeeId) !== String(employee.id) || String(item.status || "").toLowerCase() === "rejected") return false;
    const range = leaveRange(item);
    return range.start <= to && range.end >= from;
  });
  const dailyTarget = Math.round((Number(employee.weeklyHours || employee.contractHours || employee.weeklyTargetHours || 40) * 60) / 5);
  const rows = enumerateDates(from, to).map(date => {
    const entry = entries.find((item: any) => String(item.date) === date);
    const shift = shifts.find((item: any) => String(item.date) === date);
    const leave = leaves.find((item: any) => {
      const range = leaveRange(item);
      return range.start <= date && range.end >= date;
    });
    if (leave) return { date, type: leaveType(leave), start: "", end: "", breakMinutes: 0, netMinutes: dailyTarget, note: normalizeText(leave.note || leave.reason || "Genehmigte Abwesenheit") };
    if (entry) return {
      date,
      type: entry.end ? "Arbeit" : "Offen",
      start: normalizeText(entry.start),
      end: normalizeText(entry.end),
      breakMinutes: Math.max(0, Number(entry.breakMinutes) || 0),
      netMinutes: durationMinutes(entry),
      note: normalizeText(entry.note || entry.comment || (!entry.end ? "Clock-out fehlt" : "")),
    };
    if (shift) return {
      date,
      type: "Fehlzeit",
      start: normalizeText(shift.start),
      end: normalizeText(shift.end),
      breakMinutes: Math.max(0, Number(shift.breakMinutes) || 0),
      netMinutes: 0,
      note: "Keine Zeitbuchung",
    };
    return null;
  }).filter(Boolean);
  const workedMinutes = rows.reduce((sum: number, row: any) => sum + (row.type === "Arbeit" ? row.netMinutes : 0), 0);
  const creditedMinutes = rows.reduce((sum: number, row: any) => sum + (["Urlaub", "Krankheit", "Abwesenheit"].includes(row.type) ? row.netMinutes : 0), 0);
  const plannedMinutes = shifts.reduce((sum: number, item: any) => sum + durationMinutes(item), 0);
  return {
    schemaVersion: 2,
    generatedAt: new Date().toISOString(),
    organization: { id: ctx.org.id, name: externalEmployerName(ctx.state.company?.name || ctx.org.name) },
    location: {
      id: locationId,
      name: normalizeText(location.name || "Standort"),
      address: normalizeText(location.address || location.street || ""),
      city: normalizeText(location.city || ""),
      postalCode: normalizeText(location.postalCode || location.zip || ""),
      country: normalizeText(location.country || "DE"),
    },
    employee: {
      id: String(employee.id),
      name: normalizeText(employee.name || "Mitarbeiter/in"),
      personnelNumber: normalizeText(employee.personnelNumber || employee.employeeNumber || employee.staffNumber || `A-${String(employee.id).slice(-5).toUpperCase()}`),
      position: normalizeText(employee.position || employee.jobTitle || employee.role || "Mitarbeiter/in"),
      contract: normalizeText(employee.employmentType || employee.contractType || "Beschäftigt"),
      weeklyHours: Number(employee.weeklyHours || employee.contractHours || 40),
    },
    period: { from, to },
    rows,
    totals: {
      plannedMinutes,
      workedMinutes,
      creditedMinutes,
      totalMinutes: workedMinutes + creditedMinutes,
      differenceMinutes: workedMinutes + creditedMinutes - plannedMinutes,
      workDays: rows.filter((row: any) => row.type === "Arbeit").length,
      openDays: rows.filter((row: any) => ["Offen", "Fehlzeit"].includes(row.type)).length,
    },
  };
}

function columnName(index: number) {
  let value = index + 1;
  let name = "";
  while (value > 0) {
    const remainder = (value - 1) % 26;
    name = String.fromCharCode(65 + remainder) + name;
    value = Math.floor((value - 1) / 26);
  }
  return name;
}
function worksheetXml(rows: unknown[][], widths: number[]) {
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
function xlsxBytes(snapshot: any, approval: any | null) {
  const workRows: unknown[][] = [["Datum", "Art", "Beginn", "Ende", "Pause (Min.)", "Netto", "Bemerkung"]];
  for (const row of snapshot.rows) workRows.push([displayDate(row.date), row.type, row.start || "", row.end || "", row.breakMinutes, formatMinutes(row.netMinutes), row.note || ""]);
  const summaryRows: unknown[][] = [
    ["Feld", "Wert"],
    ["Dokumentstatus", approval ? "Vom Mitarbeiter bestätigt und unterschrieben" : "Nicht vom Mitarbeiter bestätigt – ohne Unterschrift"],
    ["Unternehmen", snapshot.organization.name],
    ["Standort", snapshot.location.name],
    ["Adresse", [snapshot.location.address, snapshot.location.postalCode, snapshot.location.city].filter(Boolean).join(", ")],
    ["Mitarbeiter/in", snapshot.employee.name],
    ["Personalnummer", snapshot.employee.personnelNumber],
    ["Zeitraum", `${displayDate(snapshot.period.from)} – ${displayDate(snapshot.period.to)}`],
    ["Sollzeit", formatMinutes(snapshot.totals.plannedMinutes)],
    ["Arbeitszeit", formatMinutes(snapshot.totals.workedMinutes)],
    ["Bezahlte Abwesenheit", formatMinutes(snapshot.totals.creditedMinutes)],
    ["Gesamt", formatMinutes(snapshot.totals.totalMinutes)],
    ["Differenz", formatMinutes(snapshot.totals.differenceMinutes)],
  ];
  const approvalRows: unknown[][] = approval ? [
    ["Feld", "Wert"],
    ["Status", "Vom Mitarbeiter digital bestätigt und einmalig unterschrieben"],
    ["Bestätigt am", new Date(approval.approvedAt).toLocaleString("de-DE", { timeZone: "Europe/Berlin" })],
    ["Bestätigt von", snapshot.employee.name],
    ["Dokument-Hash", approval.snapshotHash],
    ["Signatur-Hash", approval.signatureHash],
    ["Einwilligungs-Hash", approval.consentHash],
    ["Freigabe-Hash", approval.signedHash],
    ["Hinweis", "Die Unterschrift gilt ausschließlich für diese Dokumentversion und darf nicht wiederverwendet werden."],
  ] : [
    ["Feld", "Wert"],
    ["Status", "Nicht vom Mitarbeiter bestätigt"],
    ["Dokument-Hash", approval?.snapshotHash || "Siehe Systemnachweis"],
    ["Hinweis", "Dieser Export enthält keine Mitarbeiterunterschrift und stellt keine persönliche Bestätigung dar."],
  ];
  const files: Record<string, Uint8Array> = {
    "[Content_Types].xml": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/worksheets/sheet3.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>`),
    "_rels/.rels": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>`),
    "xl/workbook.xml": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Arbeitszeit" sheetId="1" r:id="rId1"/><sheet name="Zusammenfassung" sheetId="2" r:id="rId2"/><sheet name="Freigabe" sheetId="3" r:id="rId3"/></sheets></workbook>`),
    "xl/_rels/workbook.xml.rels": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet3.xml"/><Relationship Id="rId4" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`),
    "xl/worksheets/sheet1.xml": strToU8(worksheetXml(workRows, [14, 16, 11, 11, 14, 12, 42])),
    "xl/worksheets/sheet2.xml": strToU8(worksheetXml(summaryRows, [24, 64])),
    "xl/worksheets/sheet3.xml": strToU8(worksheetXml(approvalRows, [24, 100])),
    "xl/styles.xml": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="10"/><name val="Arial"/></font><font><b/><sz val="10"/><color rgb="FFFFFFFF"/><name val="Arial"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF222222"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFill="1" applyFont="1" applyAlignment="1"><alignment vertical="center"/></xf></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`),
    "docProps/core.xml": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>Arbeitszeitnachweis</dc:title><dc:creator>${xml(snapshot.organization.name)}</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${new Date().toISOString()}</dcterms:created></cp:coreProperties>`),
    "docProps/app.xml": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><Application>Microsoft Excel Compatible</Application></Properties>`),
  };
  return zipSync(files, { level: 6 });
}
function pdfSafe(value: unknown) {
  return String(value ?? "").replace(/[\u2013\u2014]/g, "-").replace(/\u2022/g, "-").replace(/[^\u000A\u0020-\u007E\u00A0-\u00FF]/g, "?");
}
function wrapText(text: string, maxChars: number) {
  const words = pdfSafe(text).split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    if (!line) line = word;
    else if (`${line} ${word}`.length <= maxChars) line += ` ${word}`;
    else { lines.push(line); line = word; }
  }
  if (line) lines.push(line);
  return lines.length ? lines : [""];
}
async function pdfBytes(snapshot: any, approval: any | null, signatureBytes: Uint8Array | null) {
  const pdf = await PDFDocument.create();
  pdf.setTitle("Arbeitszeitnachweis");
  pdf.setAuthor(snapshot.organization.name || "Arbeitgeber");
  pdf.setSubject(`${snapshot.employee.name} · ${snapshot.period.from} bis ${snapshot.period.to}`);
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const signature = signatureBytes ? await pdf.embedPng(signatureBytes) : null;
  const pageSize: [number, number] = [595.28, 841.89];
  let page = pdf.addPage(pageSize);
  let y = 800;
  const left = 42;
  const right = 553;
  function addPage() { page = pdf.addPage(pageSize); y = 800; }
  function line(text: string, size = 9, isBold = false, x = left) {
    if (y < 50) addPage();
    page.drawText(pdfSafe(text), { x, y, size, font: isBold ? bold : regular, color: rgb(0.1, 0.1, 0.1) });
    y -= size + 5;
  }
  line(snapshot.organization.name || "Arbeitgeber", 12, true);
  line(snapshot.location.name, 15, true);
  const address = [snapshot.location.address, snapshot.location.postalCode, snapshot.location.city].filter(Boolean).join(", ");
  if (address) line(address, 9);
  y -= 8;
  line("Arbeitszeitnachweis", 20, true);
  line(`${displayDate(snapshot.period.from)} - ${displayDate(snapshot.period.to)}`, 11, true);
  line(approval ? "BESTAETIGTE VERSION MIT MITARBEITERUNTERSCHRIFT" : "UNBESTAETIGTE VERSION - OHNE MITARBEITERUNTERSCHRIFT", 8, true);
  y -= 5;
  line(`Mitarbeiter/in: ${snapshot.employee.name}`, 10, true);
  line(`Personalnummer: ${snapshot.employee.personnelNumber}   Position: ${snapshot.employee.position}`, 9);
  y -= 8;
  const x = [left, 116, 204, 260, 316, 380, 438];
  const headers = ["Datum", "Art", "Beginn", "Ende", "Pause", "Netto", "Bemerkung"];
  page.drawRectangle({ x: left, y: y - 4, width: right - left, height: 18, color: rgb(0.12, 0.12, 0.12) });
  headers.forEach((header, index) => page.drawText(header, { x: x[index] + 2, y: y + 1, size: 7, font: bold, color: rgb(1, 1, 1) }));
  y -= 19;
  for (const row of snapshot.rows) {
    if (y < 92) {
      addPage();
      page.drawRectangle({ x: left, y: y - 4, width: right - left, height: 18, color: rgb(0.12, 0.12, 0.12) });
      headers.forEach((header, index) => page.drawText(header, { x: x[index] + 2, y: y + 1, size: 7, font: bold, color: rgb(1, 1, 1) }));
      y -= 19;
    }
    const values = [displayDate(row.date), row.type, row.start || "-", row.end || "-", `${row.breakMinutes || 0} Min.`, formatMinutes(row.netMinutes), row.note || "-"];
    page.drawLine({ start: { x: left, y: y - 3 }, end: { x: right, y: y - 3 }, thickness: 0.3, color: rgb(0.8, 0.8, 0.8) });
    values.forEach((value, index) => {
      const max = index === 6 ? 25 : 13;
      page.drawText(pdfSafe(String(value)).slice(0, max), { x: x[index] + 2, y, size: 7, font: index === 5 ? bold : regular, color: rgb(0.1, 0.1, 0.1) });
    });
    y -= 14;
  }
  y -= 10;
  line(`Sollzeit: ${formatMinutes(snapshot.totals.plannedMinutes)}   Arbeitszeit: ${formatMinutes(snapshot.totals.workedMinutes)}   Bezahlte Abwesenheit: ${formatMinutes(snapshot.totals.creditedMinutes)}`, 9, true);
  line(`Gesamt: ${formatMinutes(snapshot.totals.totalMinutes)}   Differenz: ${formatMinutes(snapshot.totals.differenceMinutes)}`, 10, true);
  y -= 12;
  if (y < 185) addPage();
  if (approval && signature) {
    line("Bestaetigung und einmalige Unterschrift des Mitarbeiters", 11, true);
    for (const wrapped of wrapText("Die Unterschrift wurde vom Mitarbeiter fuer genau diese Dokumentversion gezeichnet und darf nicht fuer andere Dokumente wiederverwendet werden.", 92)) line(wrapped, 8);
    line(`Bestaetigt am: ${new Date(approval.approvedAt).toLocaleString("de-DE", { timeZone: "Europe/Berlin" })}`, 8);
    line(`Dokument-Hash: ${approval.snapshotHash}`, 6);
    line(`Freigabe-Hash: ${approval.signedHash}`, 6);
    const maxWidth = 170;
    const maxHeight = 60;
    const scale = Math.min(maxWidth / signature.width, maxHeight / signature.height, 1);
    page.drawImage(signature, { x: left, y: y - signature.height * scale - 5, width: signature.width * scale, height: signature.height * scale });
    page.drawLine({ start: { x: left, y: y - signature.height * scale - 8 }, end: { x: left + 190, y: y - signature.height * scale - 8 }, thickness: 0.6, color: rgb(0.2, 0.2, 0.2) });
    page.drawText(pdfSafe(snapshot.employee.name), { x: left, y: y - signature.height * scale - 20, size: 8, font: regular });
  } else {
    line("Keine Bestaetigung des Mitarbeiters", 11, true);
    for (const wrapped of wrapText("Dieser Nachweis wurde vom Arbeitgeber als Vorschau oder Arbeitsunterlage exportiert. Er enthaelt keine Mitarbeiterunterschrift und dokumentiert keine persoenliche Bestaetigung.", 92)) line(wrapped, 8);
    line(`Dokument-Hash: ${await sha256Text(stableStringify(snapshot))}`, 6);
    y -= 18;
    page.drawLine({ start: { x: left, y }, end: { x: left + 190, y }, thickness: 0.6, color: rgb(0.45, 0.45, 0.45) });
    page.drawText("Mitarbeiterunterschrift nicht enthalten", { x: left, y: y - 13, size: 8, font: regular, color: rgb(0.35, 0.35, 0.35) });
  }
  return await pdf.save();
}

async function getSubmission(ctx: any, submissionId: string) {
  const { data } = await service.from("timesheet_submissions").select("*").eq("organization_id", ctx.org.id).eq("id", submissionId).maybeSingle();
  if (!data) fail("Arbeitszeitnachweis wurde nicht gefunden.", 404);
  employeeById(ctx, String(data.employee_id));
  return data;
}
async function assertSnapshot(submission: any) {
  const snapshot = submission.payload?.snapshot;
  if (!snapshot) fail("Der gespeicherte Nachweis ist unvollständig.", 409);
  const hash = await sha256Text(stableStringify(snapshot));
  if (hash !== submission.snapshot_hash) fail("Der gespeicherte Nachweis hat die Integritätsprüfung nicht bestanden.", 409);
  return snapshot;
}

Deno.serve(async (request: Request) => {
  const origin = request.headers.get("origin");
  if (request.method === "OPTIONS") return new Response("ok", { headers: cors(origin) });
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405, origin);
  if (!originAllowed(origin)) return json({ error: "Origin not allowed" }, 403, origin);
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > MAX_BODY_BYTES) return json({ error: "Request too large" }, 413, origin);
  let body: any;
  try { body = JSON.parse(text || "{}"); } catch { return json({ error: "Invalid request" }, 400, origin); }

  try {
    const ctx = await context(String(body.token || ""));
    const action = String(body.action || "");

    if (action === "managerOverview") {
      requireManager(ctx);
      const employees = ctx.state.employees.filter((item: any) => item.active !== false && item.status !== "revoked" && (ctx.accessRole === "owner" || ctx.locationIds.includes(String(item.locationId || item.primaryLocationId || ""))));
      const employeeIds = employees.map((item: any) => String(item.id));
      const { data: submissions } = employeeIds.length
        ? await service.from("timesheet_submissions").select("*").eq("organization_id", ctx.org.id).in("employee_id", employeeIds).order("date_from", { ascending: false }).limit(300)
        : { data: [] };
      return json({ employees, submissions: submissions || [], workflowVersion: WORKFLOW_VERSION }, 200, origin);
    }

    if (action === "employeeInbox") {
      requireEmployee(ctx);
      const employeeId = String(ctx.session.subject_id);
      const { data: submissions } = await service.from("timesheet_submissions").select("*").eq("organization_id", ctx.org.id).eq("employee_id", employeeId).order("date_from", { ascending: false }).limit(100);
      return json({ submissions: submissions || [], consentVersion: CONSENT_VERSION, consentText: CONSENT_TEXT, workflowVersion: WORKFLOW_VERSION }, 200, origin);
    }

    if (action === "prepareTimesheet") {
      requireManager(ctx);
      const employeeId = String(body.employeeId || "");
      const from = safeDate(body.dateFrom);
      const to = safeDate(body.dateTo);
      if (from > to) fail("Der Beginn liegt nach dem Ende.", 400);
      const { employee, locationId } = employeeById(ctx, employeeId);
      const snapshot = canonicalSnapshot(ctx, employee, locationId, from, to);
      const snapshotHash = await sha256Text(stableStringify(snapshot));
      const period = `${from}:${to}`;
      const { data: existing } = await service.from("timesheet_submissions").select("*").eq("organization_id", ctx.org.id).eq("employee_id", employeeId).eq("period", period).maybeSingle();
      if (existing?.status === "locked") fail("Die bestätigte Endfassung wurde bereits exportiert und ist unveränderbar. Für eine Korrektur muss ein neuer Zeitraum beziehungsweise ein dokumentierter Folgeprozess verwendet werden.", 409);
      const version = Number(existing?.version || 0) + 1;
      const record = {
        organization_id: ctx.org.id,
        id: existing?.id || crypto.randomUUID(),
        employee_id: employeeId,
        location_id: locationId || null,
        period,
        date_from: from,
        date_to: to,
        status: "open",
        version,
        submitted_at: null,
        approved_at: null,
        locked_at: null,
        sent_by: null,
        sent_at: null,
        approval_requested_at: null,
        approval_requested_by: null,
        employee_decision: null,
        employee_decided_at: null,
        employee_note: null,
        signature_id: null,
        document_signature_id: null,
        snapshot_hash: snapshotHash,
        signed_hash: null,
        exported_at: null,
        exported_by: null,
        export_format: null,
        export_checksum: null,
        signed_exported_at: null,
        signed_exported_by: null,
        signed_export_checksum: null,
        unsigned_exported_at: null,
        unsigned_exported_by: null,
        unsigned_export_checksum: null,
        payload: { snapshot, workflowVersion: WORKFLOW_VERSION, sourceRevision: ctx.snapshot.revision },
      };
      const query = existing
        ? service.from("timesheet_submissions").update(record).eq("organization_id", ctx.org.id).eq("id", existing.id)
        : service.from("timesheet_submissions").insert(record);
      const { data: submission, error } = await query.select("*").single();
      if (error) throw error;
      await audit(ctx, existing ? "TIMESHEET_DRAFT_REFRESHED" : "TIMESHEET_DRAFT_CREATED", submission.id, { employeeId, from, to, version, snapshotHash, openDays: snapshot.totals.openDays });
      return json({ submission }, existing ? 200 : 201, origin);
    }

    if (action === "requestApproval") {
      requireManager(ctx);
      const submission = await getSubmission(ctx, String(body.submissionId || ""));
      if (submission.status === "locked") fail("Die bestätigte Endfassung ist bereits gesperrt.", 409);
      const snapshot = await assertSnapshot(submission);
      if (!snapshot.rows?.length) fail("Der Nachweis enthält keine Arbeitszeitdaten.", 409);
      if (Number(snapshot.totals?.openDays || 0) > 0) fail("Offene oder fehlende Zeitbuchungen müssen vor der Mitarbeiterbestätigung korrigiert werden.", 409);
      const now = new Date().toISOString();
      const { data: updated, error } = await service.from("timesheet_submissions").update({
        status: "submitted",
        submitted_at: now,
        sent_at: now,
        sent_by: ctx.session.subject_id,
        approval_requested_at: now,
        approval_requested_by: ctx.session.subject_id,
        employee_decision: null,
        employee_decided_at: null,
        employee_note: null,
      }).eq("organization_id", ctx.org.id).eq("id", submission.id).select("*").single();
      if (error) throw error;
      await notify(ctx, String(submission.employee_id), submission.location_id || null, "Arbeitszeitnachweis bestätigen", `Bitte prüfe und unterschreibe den Arbeitszeitnachweis für ${displayDate(submission.date_from)} bis ${displayDate(submission.date_to)}.`, submission.id);
      await audit(ctx, "TIMESHEET_APPROVAL_REQUESTED", submission.id, { employeeId: submission.employee_id, version: submission.version, snapshotHash: submission.snapshot_hash });
      return json({ submission: updated }, 200, origin);
    }

    if (action === "decideTimesheet") {
      requireEmployee(ctx);
      const submissionId = String(body.submissionId || "");
      const decision = String(body.decision || "");
      if (!["approved", "declined"].includes(decision)) fail("Ungültige Entscheidung.", 400);
      const note = normalizeText(body.note || "");
      if (decision === "declined" && note.length < 5) fail("Bitte beschreibe die gewünschte Korrektur mit mindestens 5 Zeichen.", 400);
      const { data: submission } = await service.from("timesheet_submissions").select("*").eq("organization_id", ctx.org.id).eq("id", submissionId).eq("employee_id", ctx.session.subject_id).eq("status", "submitted").maybeSingle();
      if (!submission) fail("Der Nachweis ist nicht mehr zur Bestätigung offen.", 409);
      await assertSnapshot(submission);
      const decidedAt = new Date().toISOString();
      if (decision === "declined") {
        const { data: updated, error } = await service.from("timesheet_submissions").update({
          status: "open",
          employee_decision: "declined",
          employee_decided_at: decidedAt,
          employee_note: note,
        }).eq("organization_id", ctx.org.id).eq("id", submissionId).select("*").single();
        if (error) throw error;
        await audit(ctx, "TIMESHEET_CORRECTION_REQUESTED", submissionId, { employeeId: ctx.session.subject_id, note, version: submission.version });
        return json({ submission: updated }, 200, origin);
      }

      if (body.consentAccepted !== true) fail("Bitte bestätige die einmalige dokumentbezogene Einwilligung.", 400);
      const signatureBytes = decodeSignature(String(body.signatureDataUrl || ""));
      const signatureHash = await sha256Bytes(signatureBytes);
      const consentHash = await sha256Text(`${CONSENT_VERSION}\n${CONSENT_TEXT}`);
      const signedHash = await sha256Text(`${submission.snapshot_hash}\n${signatureHash}\n${consentHash}\n${ctx.session.subject_id}\n${submission.version}\n${decidedAt}`);
      const storagePath = `${ctx.org.id}/${ctx.session.subject_id}/documents/${submission.id}/v${submission.version}/${crypto.randomUUID()}.png`;
      const { error: uploadError } = await service.storage.from(SIGNATURE_BUCKET).upload(storagePath, signatureBytes, { contentType: "image/png", upsert: false, cacheControl: "0" });
      if (uploadError) throw uploadError;
      const { data: signature, error: signatureError } = await service.from("timesheet_document_signatures").insert({
        organization_id: ctx.org.id,
        submission_id: submission.id,
        submission_version: submission.version,
        employee_id: String(ctx.session.subject_id),
        storage_path: storagePath,
        sha256: signatureHash,
        byte_size: signatureBytes.length,
        consent_version: CONSENT_VERSION,
        consent_hash: consentHash,
        consent_text: CONSENT_TEXT,
        consent_accepted_at: decidedAt,
        signed_hash: signedHash,
        metadata: { source: "employee-app", workflowVersion: WORKFLOW_VERSION, snapshotHash: submission.snapshot_hash },
      }).select("*").single();
      if (signatureError) {
        await service.storage.from(SIGNATURE_BUCKET).remove([storagePath]);
        if (String(signatureError.code) === "23505") fail("Diese Dokumentversion wurde bereits unterschrieben.", 409);
        throw signatureError;
      }
      const { data: updated, error } = await service.from("timesheet_submissions").update({
        status: "approved",
        employee_decision: "approved",
        employee_decided_at: decidedAt,
        employee_note: note || null,
        document_signature_id: signature.id,
        approved_at: decidedAt,
        signed_hash: signedHash,
      }).eq("organization_id", ctx.org.id).eq("id", submissionId).select("*").single();
      if (error) throw error;
      await audit(ctx, "TIMESHEET_DOCUMENT_SIGNED", submissionId, { employeeId: ctx.session.subject_id, version: submission.version, snapshotHash: submission.snapshot_hash, signatureId: signature.id, signatureHash, consentHash, signedHash });
      return json({ submission: updated }, 200, origin);
    }

    if (action === "exportTimesheet") {
      requireManager(ctx);
      const submission = await getSubmission(ctx, String(body.submissionId || ""));
      const format = String(body.format || "pdf");
      const signed = body.signed === true;
      if (!["pdf", "xlsx"].includes(format)) fail("Exportformat wird nicht unterstützt.", 400);
      const snapshot = await assertSnapshot(submission);
      let approval: any | null = null;
      let signatureBytes: Uint8Array | null = null;
      if (signed) {
        if (!["approved", "locked"].includes(submission.status) || !submission.document_signature_id) fail("Die bestätigte Version ist noch nicht verfügbar.", 409);
        const { data: signature } = await service.from("timesheet_document_signatures").select("*").eq("organization_id", ctx.org.id).eq("id", submission.document_signature_id).eq("submission_id", submission.id).eq("submission_version", submission.version).maybeSingle();
        if (!signature) fail("Die dokumentbezogene Unterschrift wurde nicht gefunden.", 409);
        const expectedSignedHash = await sha256Text(`${submission.snapshot_hash}\n${signature.sha256}\n${signature.consent_hash}\n${submission.employee_id}\n${submission.version}\n${signature.consent_accepted_at}`);
        if (expectedSignedHash !== signature.signed_hash || expectedSignedHash !== submission.signed_hash) fail("Die digitale Freigabe hat die Integritätsprüfung nicht bestanden.", 409);
        const { data: signatureBlob, error: downloadError } = await service.storage.from(SIGNATURE_BUCKET).download(signature.storage_path);
        if (downloadError || !signatureBlob) throw downloadError || new Error("Unterschrift konnte nicht geladen werden.");
        signatureBytes = new Uint8Array(await signatureBlob.arrayBuffer());
        if (await sha256Bytes(signatureBytes) !== signature.sha256) fail("Die Unterschrift hat die Integritätsprüfung nicht bestanden.", 409);
        approval = {
          approvedAt: signature.consent_accepted_at,
          snapshotHash: submission.snapshot_hash,
          signatureHash: signature.sha256,
          consentHash: signature.consent_hash,
          signedHash: signature.signed_hash,
        };
      }
      const bytes = format === "pdf" ? await pdfBytes(snapshot, approval, signatureBytes) : xlsxBytes(snapshot, approval);
      const checksum = await sha256Bytes(bytes);
      const now = new Date().toISOString();
      if (signed) {
        await service.from("timesheet_submissions").update({
          status: "locked",
          locked_at: submission.locked_at || now,
          exported_at: now,
          exported_by: ctx.session.subject_id,
          export_format: format,
          export_checksum: checksum,
          signed_exported_at: now,
          signed_exported_by: ctx.session.subject_id,
          signed_export_checksum: checksum,
        }).eq("organization_id", ctx.org.id).eq("id", submission.id);
      } else {
        await service.from("timesheet_submissions").update({
          unsigned_exported_at: now,
          unsigned_exported_by: ctx.session.subject_id,
          unsigned_export_checksum: checksum,
        }).eq("organization_id", ctx.org.id).eq("id", submission.id);
      }
      await service.from("compliance_exports").insert({
        organization_id: ctx.org.id,
        export_type: format === "xlsx" ? "steuerberater" : "pdf",
        employee_id: submission.employee_id,
        date_from: submission.date_from,
        date_to: submission.date_to,
        exported_by: ctx.session.subject_id,
        checksum,
        row_count: snapshot.rows.length,
        metadata: { submissionId: submission.id, version: submission.version, signed, signedHash: signed ? submission.signed_hash : null, source: "timesheet-document-signing" },
      });
      await audit(ctx, signed ? "TIMESHEET_SIGNED_EXPORT" : "TIMESHEET_UNSIGNED_EXPORT", submission.id, { employeeId: submission.employee_id, format, checksum, version: submission.version });
      const suffix = signed ? "Bestaetigt" : "Ohne_Unterschrift";
      const base = `Arbeitszeitnachweis_${filenamePart(snapshot.employee.name)}_${snapshot.period.from}_${snapshot.period.to}_${suffix}`;
      return new Response(bytes, {
        status: 200,
        headers: {
          ...cors(origin),
          "Content-Type": format === "pdf" ? "application/pdf" : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "Content-Disposition": `attachment; filename="${base}.${format}"`,
          "X-Document-Checksum": checksum,
          "X-Document-Signed": signed ? "true" : "false",
        },
      });
    }

    return json({ error: "Unknown action" }, 400, origin);
  } catch (error: any) {
    console.error("Aora document-scoped timesheet signing failed", error);
    return json({ error: error instanceof Error ? error.message : String(error) }, Number(error?.status || 500), origin);
  }
});
