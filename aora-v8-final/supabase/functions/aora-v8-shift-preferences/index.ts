import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";

const URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const DEFAULT_ORIGIN = "https://dopamine-blond.vercel.app";
const PREVIEW_SUFFIX = "-mobins-projects-4f428afa.vercel.app";
const EXACT_ORIGINS = new Set([
  DEFAULT_ORIGIN,
  "https://aora-workforce.vercel.app",
  "https://dopamine-mobins-projects-4f428afa.vercel.app",
  "https://dopamine-git-main-mobins-projects-4f428afa.vercel.app",
]);
const service = createClient(URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

function allowedOrigin(origin: string | null) {
  if (!origin || origin === "null") return true;
  if (EXACT_ORIGINS.has(origin)) return true;
  try {
    const parsed = new globalThis.URL(origin);
    return (parsed.protocol === "https:" && parsed.hostname.endsWith(PREVIEW_SUFFIX))
      || (parsed.protocol === "http:" && ["localhost", "127.0.0.1"].includes(parsed.hostname));
  } catch { return false; }
}
function headers(origin: string | null) {
  return {
    "access-control-allow-origin": origin && allowedOrigin(origin) ? origin : DEFAULT_ORIGIN,
    "access-control-allow-headers": "content-type,authorization,apikey,x-client-info",
    "access-control-allow-methods": "POST,OPTIONS",
    "access-control-max-age": "600",
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    "vary": "Origin",
  };
}
function reply(body: unknown, status = 200, origin: string | null = null) {
  return new Response(JSON.stringify(body), { status, headers: headers(origin) });
}
function fail(message: string, status = 400, data: Record<string, unknown> = {}): never {
  throw Object.assign(new Error(message), { status, data });
}
function asDate(value: unknown) {
  const text = String(value || "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) fail("Datum ist ungültig.");
  return text;
}
function asTime(value: unknown) {
  const text = String(value || "").slice(0, 5);
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(text)) fail("Uhrzeit ist ungültig.");
  return text;
}
function dateInBerlin() {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Berlin" }).format(new Date());
}
function dateDistance(date: string) {
  return Math.round((new Date(`${date}T12:00:00Z`).getTime() - new Date(`${dateInBerlin()}T12:00:00Z`).getTime()) / 86400000);
}
function durationMinutes(start: string, end: string, breakMinutes: number) {
  const [sh, sm] = start.split(":").map(Number);
  const [eh, em] = end.split(":").map(Number);
  return eh * 60 + em - sh * 60 - sm - breakMinutes;
}
function row(item: any) {
  return {
    id: String(item.id),
    employeeId: String(item.employee_id),
    locationId: String(item.location_id),
    date: String(item.preference_date),
    start: String(item.start_time).slice(0, 5),
    end: String(item.end_time).slice(0, 5),
    breakMinutes: Number(item.break_minutes || 0),
    note: item.note || "",
    status: item.status,
    decisionReason: item.decision_reason || "",
    decidedBy: item.decided_by || null,
    decidedAt: item.decided_at || null,
    resultingShiftId: item.resulting_shift_id || null,
    version: Number(item.version || 1),
    createdAt: item.created_at,
    updatedAt: item.updated_at,
  };
}

async function context(token: string) {
  if (token.length !== 64) fail("Sitzungstoken fehlt.", 401);
  const sessions = await service.rpc("validate_demo_session", { p_token: token });
  if (sessions.error || !sessions.data?.length) fail("Sitzung ist ungültig oder abgelaufen.", 401);
  const session = sessions.data[0];
  const organization = await service.from("organizations").select("id,slug,status").eq("id", session.organization_id).eq("status", "active").single();
  if (organization.error || !organization.data) fail("Organisation ist nicht aktiv.", 403);
  const snapshot = await service.from("workspace_snapshots").select("state,revision").eq("organization_id", organization.data.id).single();
  if (snapshot.error || !snapshot.data) fail("Arbeitsbereich konnte nicht geladen werden.", 404);
  const state: any = snapshot.data.state && typeof snapshot.data.state === "object" ? snapshot.data.state : {};
  const employee = session.role === "employee" ? (state.employees || []).find((item: any) => String(item.id) === String(session.subject_id) && item.active !== false) : null;
  const admin = session.role === "admin" ? (state.admins || []).find((item: any) => String(item.id) === String(session.subject_id) && item.active !== false && item.status !== "revoked") : null;
  const accessRole = session.role === "admin" ? (admin?.scope === "owner" ? "owner" : "manager") : session.role;
  if (session.role === "employee" && !employee) fail("Mitarbeiterkonto wurde nicht gefunden.", 403);
  if (session.role === "admin" && !admin) fail("Administrationszugang wurde deaktiviert.", 403);
  let locationIds: string[] = [];
  if (accessRole === "owner") locationIds = (state.locations || []).filter((item: any) => item.active !== false).map((item: any) => String(item.id));
  else if (accessRole === "manager") {
    const access = await service.from("manager_location_access").select("location_id").eq("organization_id", organization.data.id).eq("manager_id", session.subject_id);
    if (access.error) throw access.error;
    locationIds = (access.data || []).map((item: any) => String(item.location_id));
    if (!locationIds.length) fail("Für diesen Manager ist kein Standortzugriff eingerichtet.", 403);
  } else if (employee?.locationId) locationIds = [String(employee.locationId)];
  return { session, organization: organization.data, snapshot: snapshot.data, state, employee, admin, accessRole, locationIds };
}

async function loadPreferences(ctx: any) {
  let query = service.from("aora_shift_preferences").select("*").eq("organization_id", ctx.organization.id).order("preference_date", { ascending: true }).order("start_time", { ascending: true }).limit(1000);
  if (ctx.accessRole === "employee") query = query.eq("employee_id", ctx.session.subject_id);
  else if (["owner", "manager"].includes(ctx.accessRole)) query = query.in("location_id", ctx.locationIds);
  else fail("Dieser Zugang darf keine Schichtwünsche laden.", 403);
  const result = await query;
  if (result.error) throw result.error;
  return (result.data || []).map(row);
}

function normalizePreference(input: any) {
  const date = asDate(input?.date);
  const start = asTime(input?.start);
  const end = asTime(input?.end);
  const breakMinutes = Number(input?.breakMinutes || 0);
  const note = String(input?.note || "").trim();
  const distance = dateDistance(date);
  if (distance < 0 || distance > 180) fail("Schichtwünsche sind nur für die nächsten 180 Tage möglich.");
  if (!Number.isInteger(breakMinutes) || breakMinutes < 0 || breakMinutes > 180) fail("Pause ist ungültig.");
  if (note.length > 240) fail("Die Notiz darf höchstens 240 Zeichen enthalten.");
  if (end <= start || durationMinutes(start, end, breakMinutes) <= 0) fail("Ende muss nach dem Beginn liegen.");
  if (durationMinutes(start, end, breakMinutes) > 720) fail("Der Schichtwunsch ist zu lang.");
  return { date, start, end, breakMinutes, note };
}

async function createPreference(ctx: any, input: any) {
  if (ctx.accessRole !== "employee") fail("Nur Mitarbeiter können Schichtwünsche abgeben.", 403);
  const value = normalizePreference(input);
  const overlap = await service.from("aora_shift_preferences").select("id").eq("organization_id", ctx.organization.id).eq("employee_id", ctx.session.subject_id).eq("preference_date", value.date).eq("status", "pending").lt("start_time", `${value.end}:00`).gt("end_time", `${value.start}:00`).limit(1);
  if (overlap.error) throw overlap.error;
  if (overlap.data?.length) fail("Für diesen Zeitraum besteht bereits ein offener Schichtwunsch.", 409);
  const inserted = await service.from("aora_shift_preferences").insert({
    organization_id: ctx.organization.id,
    employee_id: ctx.session.subject_id,
    location_id: ctx.employee.locationId,
    preference_date: value.date,
    start_time: value.start,
    end_time: value.end,
    break_minutes: value.breakMinutes,
    note: value.note || null,
    status: "pending",
  }).select("*").single();
  if (inserted.error) {
    if (String(inserted.error.code) === "23505") fail("Dieser Schichtwunsch wurde bereits gesendet.", 409);
    throw inserted.error;
  }
}

async function cancelPreference(ctx: any, id: string) {
  if (ctx.accessRole !== "employee") fail("Nur Mitarbeiter können eigene Schichtwünsche zurückziehen.", 403);
  const updated = await service.from("aora_shift_preferences").update({ status: "cancelled", updated_at: new Date().toISOString(), version: 2 }).eq("id", id).eq("organization_id", ctx.organization.id).eq("employee_id", ctx.session.subject_id).eq("status", "pending").select("id").maybeSingle();
  if (updated.error) throw updated.error;
  if (!updated.data) fail("Der Schichtwunsch ist nicht mehr offen.", 409);
}

async function decidePreference(ctx: any, body: any) {
  if (!["owner", "manager"].includes(ctx.accessRole)) fail("Nur Inhaber oder Manager können Schichtwünsche entscheiden.", 403);
  const decision = String(body.decision || "");
  if (!["accepted", "rejected"].includes(decision)) fail("Entscheidung ist ungültig.");
  const selected = await service.from("aora_shift_preferences").select("*").eq("id", String(body.id || "")).eq("organization_id", ctx.organization.id).single();
  if (selected.error || !selected.data) fail("Schichtwunsch wurde nicht gefunden.", 404);
  const preference = row(selected.data);
  if (preference.status !== "pending") fail("Der Schichtwunsch wurde bereits entschieden.", 409);
  if (!ctx.locationIds.includes(preference.locationId)) fail("Kein Zugriff auf diesen Standort.", 403);
  let shift: any = null;
  let evaluation: any = null;
  if (decision === "accepted") {
    const proposed = normalizePreference({ ...body.shift, date: preference.date });
    if (String(body.shift?.employeeId || "") !== preference.employeeId || String(body.shift?.locationId || "") !== preference.locationId) fail("Schichtdaten passen nicht zum Wunsch.");
    shift = { ...body.shift, employeeId: preference.employeeId, locationId: preference.locationId, date: preference.date, start: proposed.start, end: proposed.end, breakMinutes: proposed.breakMinutes, status: "draft" };
    const evaluated = await service.rpc("aora_evaluate_shift_rules", {
      p_organization_id: ctx.organization.id,
      p_employee_id: preference.employeeId,
      p_location_id: preference.locationId,
      p_date: preference.date,
      p_start: shift.start,
      p_end: shift.end,
      p_break_minutes: shift.breakMinutes,
      p_existing_shifts: Array.isArray(ctx.state.shifts) ? ctx.state.shifts : [],
      p_exclude_shift_id: null,
      p_override_reason: null,
      p_actor_type: ctx.accessRole,
      p_actor_id: ctx.session.subject_id,
    });
    if (evaluated.error) throw evaluated.error;
    evaluation = evaluated.data;
    if (!evaluation?.valid) fail(evaluation?.requiresConfirmation ? "Bestätigung einer Arbeitszeitregel ist erforderlich." : "Der Schichtwunsch verletzt eine blockierende Arbeitszeitregel.", evaluation?.requiresConfirmation ? 428 : 422, { ruleEvaluation: evaluation });
    shift = {
      ...shift,
      ruleSetId: evaluation.ruleSetId || null,
      ruleSetVersion: evaluation.ruleSetVersion || null,
      ruleEvaluationId: evaluation.evaluationId || null,
      ruleOverrides: [],
    };
  }
  const decided = await service.rpc("aora_decide_shift_preference", {
    p_organization_id: ctx.organization.id,
    p_preference_id: preference.id,
    p_expected_revision: Number(body.expectedRevision),
    p_decision: decision,
    p_actor_role: ctx.accessRole,
    p_actor_id: ctx.session.subject_id,
    p_actor_name: ctx.admin?.name || ctx.session.display_name || "Administration",
    p_reason: String(body.reason || "").trim() || null,
    p_shift: shift,
  });
  if (decided.error) {
    const message = String(decided.error.message || "");
    if (message.includes("revision_conflict")) fail("Daten wurden auf einem anderen Gerät geändert. Bitte erneut versuchen.", 409, { conflict: true });
    if (message.includes("shift_overlap")) fail("Die Schicht überschneidet sich mit einer bestehenden Schicht.", 409);
    if (message.includes("already_decided")) fail("Der Schichtwunsch wurde bereits entschieden.", 409);
    throw decided.error;
  }
  const result = Array.isArray(decided.data) ? decided.data[0] : decided.data;
  return { revision: Number(result?.revision), resultingShiftId: result?.resulting_shift_id || null, ruleEvaluation: evaluation };
}

Deno.serve(async (request: Request) => {
  const origin = request.headers.get("origin");
  if (request.method === "OPTIONS") return new Response("ok", { headers: headers(origin) });
  if (request.method !== "POST") return reply({ error: "Method not allowed" }, 405, origin);
  if (origin && !allowedOrigin(origin)) return reply({ error: "Origin not allowed" }, 403, origin);
  try {
    const body = await request.json();
    const ctx = await context(String(body.token || ""));
    if (body.action === "load") return reply({ preferences: await loadPreferences(ctx) }, 200, origin);
    if (body.action === "create") await createPreference(ctx, body.preference);
    else if (body.action === "cancel") await cancelPreference(ctx, String(body.id || ""));
    else if (body.action === "decide") {
      const result = await decidePreference(ctx, body);
      return reply({ ...result, preferences: await loadPreferences(ctx) }, 200, origin);
    } else return reply({ error: "Unbekannte Aktion." }, 400, origin);
    return reply({ preferences: await loadPreferences(ctx) }, 200, origin);
  } catch (error: any) {
    console.warn("aora-shift-preference-rejected", { status: error?.status || 500, message: error?.message || String(error) });
    return reply({ error: error instanceof Error ? error.message : String(error), ...(error?.data || {}) }, Number(error?.status || 500), origin);
  }
});
