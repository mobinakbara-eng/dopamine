import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const service = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const WORKFLOW_VERSION = "2026-08-06.1";
const DEFAULT_ORIGIN = "https://dopamine-mobins-projects-4f428afa.vercel.app";
const TEAM_SUFFIX = "-mobins-projects-4f428afa.vercel.app";
const EXACT_ORIGINS = new Set([
  DEFAULT_ORIGIN,
  "https://dopamine-blond.vercel.app",
  "https://aora-v8-hardening.vercel.app",
  "https://aora-v8-final.vercel.app",
  "https://aora-workforce.vercel.app",
]);
const MAX_BODY_BYTES = 200_000;

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
    "Access-Control-Allow-Headers": "content-type,authorization,apikey",
    "Access-Control-Allow-Methods": "POST,OPTIONS",
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
  for (const key of ["admins", "employees", "locations"]) {
    if (!Array.isArray(state?.[key])) state[key] = [];
  }
  return state;
}
function normalizeText(value: unknown) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}
function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.keys(value as Record<string, unknown>).sort().reduce<Record<string, unknown>>((result, key) => {
      result[key] = stableValue((value as Record<string, unknown>)[key]);
      return result;
    }, {});
  }
  return value;
}
function stableStringify(value: unknown) {
  return JSON.stringify(stableValue(value));
}
async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest)).map(part => part.toString(16).padStart(2, "0")).join("");
}
function displayDate(value: string) {
  return new Intl.DateTimeFormat("de-DE", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "UTC" })
    .format(new Date(`${value}T12:00:00Z`));
}

async function context(token: string) {
  if (token.length !== 64) fail("Sitzungstoken fehlt.", 401);
  const { data: sessions, error } = await service.rpc("validate_demo_session", { p_token: token });
  if (error || !sessions?.length) fail("Sitzung ist ungültig oder abgelaufen.", 401);
  const session = sessions[0];
  const { data: organization } = await service
    .from("organizations")
    .select("id,slug,name,status,timezone")
    .eq("id", session.organization_id)
    .eq("status", "active")
    .single();
  if (!organization) fail("Organisation ist nicht aktiv.", 403);
  const { data: snapshot } = await service
    .from("workspace_snapshots")
    .select("state,revision")
    .eq("organization_id", organization.id)
    .single();
  if (!snapshot) fail("Arbeitsbereich wurde nicht gefunden.", 404);
  const state = normalizeState(structuredClone(snapshot.state || {}));
  const admin = session.role === "admin"
    ? state.admins.find((item: any) => item.id === session.subject_id && item.active !== false && item.status !== "revoked")
    : null;
  const employee = session.role === "employee"
    ? state.employees.find((item: any) => item.id === session.subject_id && item.active !== false && item.status !== "revoked")
    : null;
  const accessRole = admin ? (admin.scope === "owner" ? "owner" : "manager") : (employee ? "employee" : session.role);
  let locationIds: string[] = [];
  if (accessRole === "owner") {
    locationIds = state.locations.filter((item: any) => item.active !== false).map((item: any) => String(item.id));
  }
  if (accessRole === "manager") {
    const { data: rows } = await service.from("manager_location_access")
      .select("location_id")
      .eq("organization_id", organization.id)
      .eq("manager_id", session.subject_id);
    locationIds = (rows || []).map((row: any) => String(row.location_id));
    if (!locationIds.length) locationIds = (admin?.locationIds || [admin?.locationId]).filter(Boolean).map(String);
  }
  if (accessRole === "employee") {
    const locationId = employee?.locationId || employee?.primaryLocationId;
    if (locationId) locationIds = [String(locationId)];
  }
  return { session, organization, snapshot, state, admin, employee, accessRole, locationIds };
}
function requireManager(ctx: any) {
  if (!["owner", "manager"].includes(ctx.accessRole)) fail("Manager-Zugang erforderlich.", 403);
}
function requireEmployee(ctx: any) {
  if (ctx.accessRole !== "employee" || !ctx.employee) fail("Mitarbeiter-Zugang erforderlich.", 403);
}
function canAccessEmployee(ctx: any, employeeId: string, locationId: string | null) {
  if (ctx.accessRole === "owner") return true;
  if (ctx.accessRole === "employee") return String(ctx.session.subject_id) === employeeId;
  return ctx.accessRole === "manager" && Boolean(locationId) && ctx.locationIds.includes(String(locationId));
}
async function assertSnapshot(submission: any) {
  const snapshot = submission.payload?.snapshot;
  if (!snapshot) fail("Der gespeicherte Nachweis ist unvollständig.", 409);
  const hash = await sha256(stableStringify(snapshot));
  if (hash !== submission.snapshot_hash) fail("Der gespeicherte Nachweis hat die Integritätsprüfung nicht bestanden.", 409);
  return snapshot;
}
async function audit(ctx: any, action: string, submission: any, payload: Record<string, unknown> = {}) {
  await service.from("audit_logs").insert({
    organization_id: ctx.organization.id,
    id: crypto.randomUUID(),
    action,
    actor: ctx.session.subject_id,
    actor_type: ctx.accessRole,
    actor_id: ctx.session.subject_id,
    entity: "timesheet_submission",
    entity_type: "timesheet_submission",
    entity_id: submission.id,
    created_at: new Date().toISOString(),
    payload,
    metadata: { source: "timesheet-optional-approval", workflowVersion: WORKFLOW_VERSION },
  });
}
async function getSubmission(ctx: any, submissionId: string) {
  const { data } = await service.from("timesheet_submissions")
    .select("*")
    .eq("organization_id", ctx.organization.id)
    .eq("id", submissionId)
    .maybeSingle();
  if (!data) fail("Arbeitszeitnachweis wurde nicht gefunden.", 404);
  if (!canAccessEmployee(ctx, String(data.employee_id), data.location_id || null)) fail("Kein Zugriff auf diesen Nachweis.", 403);
  return data;
}

async function requestOptionalApproval(ctx: any, submissionId: string) {
  requireManager(ctx);
  const submission = await getSubmission(ctx, submissionId);
  if (submission.status === "locked") fail("Die bestätigte Endfassung ist bereits gesperrt.", 409);
  const snapshot = await assertSnapshot(submission);
  if (!snapshot.rows?.length) fail("Der Nachweis enthält keine Arbeitszeitdaten.", 409);
  if (Number(snapshot.totals?.openDays || 0) > 0) {
    fail("Offene oder fehlende Zeitbuchungen müssen vor der Mitarbeiterbestätigung korrigiert werden.", 409);
  }
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
    approval_method: null,
    acknowledgement_hash: null,
    acknowledged_at: null,
    acknowledged_by: null,
  }).eq("organization_id", ctx.organization.id).eq("id", submission.id).select("*").single();
  if (error) throw error;
  await service.from("notifications").insert({
    organization_id: ctx.organization.id,
    id: crypto.randomUUID(),
    employee_id: submission.employee_id,
    location_id: submission.location_id || null,
    type: "timesheet_approval",
    title: "Arbeitszeitnachweis prüfen",
    body: `Bitte prüfe den Arbeitszeitnachweis für ${displayDate(submission.date_from)} bis ${displayDate(submission.date_to)}. Du kannst ihn mit oder ohne Unterschrift bestätigen.`,
    related_entity_type: "timesheet_submission",
    related_entity_id: submission.id,
    read: false,
    created_at: now,
    payload: { source: "timesheet-optional-approval", signatureOptional: true, workflowVersion: WORKFLOW_VERSION },
  });
  await audit(ctx, "TIMESHEET_OPTIONAL_APPROVAL_REQUESTED", submission, {
    employeeId: submission.employee_id,
    version: submission.version,
    snapshotHash: submission.snapshot_hash,
  });
  return updated;
}

async function approveWithoutSignature(ctx: any, submissionId: string, note: string) {
  requireEmployee(ctx);
  const { data: submission } = await service.from("timesheet_submissions")
    .select("*")
    .eq("organization_id", ctx.organization.id)
    .eq("id", submissionId)
    .eq("employee_id", ctx.session.subject_id)
    .eq("status", "submitted")
    .maybeSingle();
  if (!submission) fail("Der Nachweis ist nicht mehr zur Bestätigung offen.", 409);
  await assertSnapshot(submission);
  const acknowledgedAt = new Date().toISOString();
  const acknowledgementHash = await sha256([
    submission.snapshot_hash,
    String(ctx.session.subject_id),
    String(submission.version),
    acknowledgedAt,
    normalizeText(note),
    "acknowledgement-without-signature",
  ].join("\n"));
  const { data: updated, error } = await service.from("timesheet_submissions").update({
    status: "approved",
    employee_decision: "approved",
    employee_decided_at: acknowledgedAt,
    employee_note: normalizeText(note) || null,
    approved_at: acknowledgedAt,
    approval_method: "acknowledgement",
    acknowledgement_hash: acknowledgementHash,
    acknowledged_at: acknowledgedAt,
    acknowledged_by: String(ctx.session.subject_id),
    document_signature_id: null,
    signed_hash: null,
  }).eq("organization_id", ctx.organization.id).eq("id", submission.id).select("*").single();
  if (error) throw error;
  await audit(ctx, "TIMESHEET_ACKNOWLEDGED_WITHOUT_SIGNATURE", submission, {
    employeeId: ctx.session.subject_id,
    version: submission.version,
    snapshotHash: submission.snapshot_hash,
    acknowledgementHash,
  });
  return updated;
}

async function unsignedApprovals(ctx: any) {
  let query = service.from("timesheet_submissions")
    .select("id,employee_id,location_id,approval_method,acknowledged_at,status")
    .eq("organization_id", ctx.organization.id)
    .eq("approval_method", "acknowledgement")
    .in("status", ["approved", "locked"])
    .order("acknowledged_at", { ascending: false })
    .limit(300);
  if (ctx.accessRole === "employee") query = query.eq("employee_id", ctx.session.subject_id);
  if (ctx.accessRole === "manager") query = query.in("location_id", ctx.locationIds.length ? ctx.locationIds : ["__none__"]);
  const { data, error } = await query;
  if (error) throw error;
  return data || [];
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
    if (action === "requestOptionalApproval") {
      return json({ submission: await requestOptionalApproval(ctx, String(body.submissionId || "")) }, 200, origin);
    }
    if (action === "approveWithoutSignature") {
      return json({ submission: await approveWithoutSignature(ctx, String(body.submissionId || ""), normalizeText(body.note || "")) }, 200, origin);
    }
    if (action === "unsignedApprovals") {
      return json({ submissions: await unsignedApprovals(ctx), workflowVersion: WORKFLOW_VERSION }, 200, origin);
    }
    return json({ error: "Unknown action" }, 400, origin);
  } catch (error: any) {
    console.error("Aora optional timesheet approval failed", error);
    return json({ error: error instanceof Error ? error.message : String(error) }, Number(error?.status || 500), origin);
  }
});