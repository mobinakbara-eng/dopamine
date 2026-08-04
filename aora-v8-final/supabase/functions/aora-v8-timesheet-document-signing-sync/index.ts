import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import { buildCanonicalSnapshot, stableStringify } from "./aggregation.mjs";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const service = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const CORE_FUNCTION = "aora-v8-timesheet-document-signing";
const WORKFLOW_VERSION = "2026-08-04.2-sync";
const DEFAULT_ORIGIN = "https://dopamine-mobins-projects-4f428afa.vercel.app";
const TEAM_SUFFIX = "-mobins-projects-4f428afa.vercel.app";
const MAX_BODY_BYTES = 1_500_000;
const EXACT_ORIGINS = new Set([
  DEFAULT_ORIGIN,
  "https://dopamine-blond.vercel.app",
  "https://dopamine-git-main-mobins-projects-4f428afa.vercel.app",
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

function safeDate(value: unknown) {
  const date = String(value || "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) fail("Ungültiges Datum.", 400);
  return date;
}

async function sha256Text(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest)).map(part => part.toString(16).padStart(2, "0")).join("");
}

async function context(token: string) {
  if (token.length !== 64) fail("Sitzungstoken fehlt.", 401);
  const { data: sessions, error } = await service.rpc("validate_demo_session", { p_token: token });
  if (error || !sessions?.length) fail("Sitzung ist ungültig oder abgelaufen.", 401);
  const session = sessions[0];
  const { data: organization } = await service.from("organizations").select("id,slug,name,status,timezone").eq("id", session.organization_id).eq("status", "active").single();
  if (!organization) fail("Organisation ist nicht aktiv.", 403);
  const { data: snapshot } = await service.from("workspace_snapshots").select("state,revision").eq("organization_id", organization.id).single();
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
  if (accessRole === "owner") locationIds = state.locations.filter((item: any) => item.active !== false).map((item: any) => String(item.id));
  if (accessRole === "manager") {
    const { data: rows } = await service.from("manager_location_access").select("location_id").eq("organization_id", organization.id).eq("manager_id", session.subject_id);
    locationIds = (rows || []).map((row: any) => String(row.location_id));
    if (!locationIds.length) locationIds = (admin?.locationIds || [admin?.locationId]).filter(Boolean).map(String);
  }
  return { session, organization, snapshot, state, accessRole, locationIds };
}

function requireManager(ctx: any) {
  if (!["owner", "manager"].includes(ctx.accessRole)) fail("Manager-Zugang erforderlich.", 403);
}

function employeeById(ctx: any, employeeId: string) {
  const employee = ctx.state.employees.find((item: any) => String(item.id) === employeeId && item.active !== false && item.status !== "revoked");
  if (!employee) fail("Mitarbeiter wurde nicht gefunden.", 404);
  const locationId = String(employee.locationId || employee.primaryLocationId || "");
  if (ctx.accessRole === "manager" && !ctx.locationIds.includes(locationId)) fail("Kein Zugriff auf diesen Mitarbeiter.", 403);
  return { employee, locationId };
}

function locationById(ctx: any, locationId: string) {
  return ctx.state.locations.find((item: any) => String(item.id) === locationId) || { id: locationId, name: "Standort", address: "", city: "" };
}

async function audit(ctx: any, submissionId: string, action: string, payload: Record<string, unknown>) {
  const { error } = await service.from("audit_logs").insert({
    organization_id: ctx.organization.id,
    id: crypto.randomUUID(),
    action,
    actor: ctx.session.subject_id,
    actor_type: ctx.accessRole,
    actor_id: ctx.session.subject_id,
    entity: "timesheet_submission",
    entity_type: "timesheet_submission",
    entity_id: submissionId,
    created_at: new Date().toISOString(),
    payload,
    metadata: { source: "timesheet-document-signing-sync", workflowVersion: WORKFLOW_VERSION },
  });
  if (error) console.warn("Timesheet sync audit write failed", error);
}

async function proxyToCore(text: string, origin: string | null) {
  const upstream = await fetch(`${SUPABASE_URL}/functions/v1/${CORE_FUNCTION}`, {
    method: "POST",
    headers: {
      "Content-Type": "text/plain;charset=UTF-8",
      Authorization: `Bearer ${SERVICE_KEY}`,
      apikey: SERVICE_KEY,
    },
    body: text,
  });
  const headers = new Headers(cors(origin));
  for (const name of ["content-type", "content-disposition", "x-document-checksum", "x-document-signed"]) {
    const value = upstream.headers.get(name);
    if (value) headers.set(name, value);
  }
  return new Response(upstream.body, { status: upstream.status, headers });
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

  if (String(body.action || "") !== "prepareTimesheet") {
    try { return await proxyToCore(text, origin); }
    catch (error) {
      console.error("Timesheet core proxy failed", error);
      return json({ error: "Arbeitszeitnachweis-Service ist vorübergehend nicht erreichbar." }, 503, origin);
    }
  }

  try {
    const ctx = await context(String(body.token || ""));
    requireManager(ctx);
    const employeeId = String(body.employeeId || "");
    const from = safeDate(body.dateFrom);
    const to = safeDate(body.dateTo);
    if (from > to) fail("Der Beginn liegt nach dem Ende.", 400);
    const { employee, locationId } = employeeById(ctx, employeeId);
    const location = locationById(ctx, locationId);
    const snapshot = buildCanonicalSnapshot({
      state: ctx.state,
      organization: ctx.organization,
      employee,
      location,
      locationId,
      from,
      to,
    });
    const snapshotHash = await sha256Text(stableStringify(snapshot));
    const period = `${from}:${to}`;
    const { data: existing } = await service.from("timesheet_submissions").select("*").eq("organization_id", ctx.organization.id).eq("employee_id", employeeId).eq("period", period).maybeSingle();
    if (existing?.status === "locked") fail("Die bestätigte Endfassung wurde bereits exportiert und ist unveränderbar. Für eine Korrektur muss ein neuer Zeitraum beziehungsweise ein dokumentierter Folgeprozess verwendet werden.", 409);
    const version = Number(existing?.version || 0) + 1;
    const record = {
      organization_id: ctx.organization.id,
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
      ? service.from("timesheet_submissions").update(record).eq("organization_id", ctx.organization.id).eq("id", existing.id)
      : service.from("timesheet_submissions").insert(record);
    const { data: submission, error } = await query.select("*").single();
    if (error) throw error;
    await audit(ctx, submission.id, existing ? "TIMESHEET_DRAFT_REFRESHED" : "TIMESHEET_DRAFT_CREATED", {
      employeeId,
      from,
      to,
      version,
      snapshotHash,
      openDays: snapshot.totals.openDays,
      entryCount: snapshot.totals.entryCount,
      sourceRevision: ctx.snapshot.revision,
    });
    return json({ submission }, existing ? 200 : 201, origin);
  } catch (error: any) {
    console.error("Aora synchronized timesheet preparation failed", error);
    return json({ error: error instanceof Error ? error.message : String(error) }, Number(error?.status || 500), origin);
  }
});
