import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";

const URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const UPSTREAM = `${URL}/functions/v1/aora-v8-pilot-workspace`;
const INVITATION_TARGET = `${URL}/functions/v1/aora-v8-invitation-patch`;
const DEFAULT_ORIGIN = "https://dopamine-blond.vercel.app";
const TEAM_PREVIEW_SUFFIX = "-mobins-projects-4f428afa.vercel.app";
const MAX_BODY_BYTES = 2_500_000;
const EXACT_ORIGINS = new Set([
  DEFAULT_ORIGIN,
  "https://dopamine-mobins-projects-4f428afa.vercel.app",
  "https://dopamine-git-main-mobins-projects-4f428afa.vercel.app",
  "https://aora-v8-hardening.vercel.app",
  "https://aora-v8-final.vercel.app",
  "https://aora-workforce.vercel.app",
]);
const SHIFT_EVENTS = new Set(["ADD_SHIFT", "UPDATE_SHIFT"]);
const INVITATION_EVENTS = new Set(["INVITE_MANAGER", "CREATE_EMPLOYEE_ACCOUNT", "RESEND_INVITATION", "REVOKE_INVITATION"]);
const service = createClient(URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const RULE_SUMMARY_TTL_MS = 15_000;
const ruleSummaryCache = new Map<string, { expiresAt: number; value: Promise<any> }>();

function allowedOrigin(origin: string | null) {
  if (!origin) return true;
  if (EXACT_ORIGINS.has(origin)) return true;
  try {
    const parsed = new globalThis.URL(origin);
    if (["localhost", "127.0.0.1"].includes(parsed.hostname)) return true;
    return parsed.protocol === "https:" && parsed.hostname.endsWith(TEAM_PREVIEW_SUFFIX);
  } catch { return false; }
}
function cors(origin: string | null) {
  const value = origin && allowedOrigin(origin) ? origin : DEFAULT_ORIGIN;
  return {
    "Access-Control-Allow-Origin": value,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Max-Age": "600",
    Vary: "Origin",
  };
}
function reply(body: unknown, status = 200, origin: string | null = null) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...cors(origin),
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      "referrer-policy": "no-referrer",
    },
  });
}
async function callUpstream(body: unknown, origin: string | null) {
  const response = await fetch(UPSTREAM, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${SERVICE_KEY}`,
      apikey: SERVICE_KEY,
      ...(origin && allowedOrigin(origin) ? { "x-aora-request-origin": origin } : {}),
    },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  let data: any;
  try { data = text ? JSON.parse(text) : {}; } catch { data = { error: text }; }
  return { ok: response.ok, status: response.status, data };
}
async function callInvitation(body: unknown) {
  const response = await fetch(INVITATION_TARGET, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${SERVICE_KEY}`,
      apikey: SERVICE_KEY,
    },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  let data: any;
  try { data = text ? JSON.parse(text) : {}; } catch { data = { error: text }; }
  return { ok: response.ok, status: response.status, data };
}
async function sessionFor(token: string) {
  const { data, error } = await service.rpc("validate_demo_session", { p_token: token });
  if (error || !data?.length) throw Object.assign(new Error("Sitzung ist ungültig oder abgelaufen."), { status: 401 });
  return data[0];
}
async function repairEmployeeLeaveDefaults(token: string) {
  const session = await sessionFor(token);
  if (session.role !== "employee") throw Object.assign(new Error("Nur Mitarbeiter dürfen eigene Abwesenheiten beantragen."), { status: 403 });
  const { data: snapshot, error } = await service.from("workspace_snapshots").select("state,revision").eq("organization_id", session.organization_id).single();
  if (error || !snapshot) throw Object.assign(new Error("Arbeitsbereich konnte nicht geladen werden."), { status: 404 });
  const state: any = snapshot.state && typeof snapshot.state === "object" ? structuredClone(snapshot.state) : {};
  const employees = Array.isArray(state.employees) ? state.employees : [];
  const index = employees.findIndex((item: any) => String(item.id) === String(session.subject_id));
  if (index < 0) throw Object.assign(new Error("Mitarbeiter wurde nicht gefunden."), { status: 404 });
  const employee = employees[index];
  const rawAllowance = Number(employee.vacationAllowance);
  const rawUsed = Number(employee.vacationUsed);
  const allowance = Number.isFinite(rawAllowance) && rawAllowance >= 0 ? rawAllowance : 27.5;
  const used = Number.isFinite(rawUsed) && rawUsed >= 0 ? rawUsed : 0;
  if (employee.vacationAllowance === allowance && employee.vacationUsed === used) return;
  employees[index] = { ...employee, vacationAllowance: allowance, vacationUsed: used };
  state.employees = employees;
  const { data: updated, error: updateError } = await service.from("workspace_snapshots")
    .update({ state, updated_at: new Date().toISOString() })
    .eq("organization_id", session.organization_id)
    .eq("revision", snapshot.revision)
    .select("revision")
    .maybeSingle();
  if (updateError || !updated) throw Object.assign(new Error("Mitarbeiterdaten wurden parallel geändert. Bitte erneut versuchen."), { status: 409 });
}
async function enrichStoredLeaveDecision(token: string, eventInput: any) {
  const session = await sessionFor(token);
  if (session.role !== "admin") throw Object.assign(new Error("Nur Inhaber oder Manager dürfen Abwesenheiten entscheiden."), { status: 403 });
  const { data: snapshot, error } = await service.from("workspace_snapshots").select("state").eq("organization_id", session.organization_id).single();
  if (error || !snapshot) throw Object.assign(new Error("Arbeitsbereich konnte nicht geladen werden."), { status: 404 });
  const state: any = snapshot.state && typeof snapshot.state === "object" ? snapshot.state : {};
  const leaveRequests = Array.isArray(state.leaveRequests) ? state.leaveRequests : [];
  const employees = Array.isArray(state.employees) ? state.employees : [];
  const request = leaveRequests.find((item: any) => String(item.id) === String(eventInput?.id));
  if (!request) throw Object.assign(new Error("Abwesenheitsantrag wurde nicht gefunden."), { status: 404 });
  const employee = employees.find((item: any) => String(item.id) === String(request.employeeId));
  if (!employee?.locationId) throw Object.assign(new Error("Standort des Mitarbeiters konnte nicht ermittelt werden."), { status: 409 });
  return { ...eventInput, locationId: String(employee.locationId) };
}
async function loadContext(token: string) {
  const session = await sessionFor(token);
  const { data: organization, error: orgError } = await service.from("organizations").select("id,slug,status").eq("id", session.organization_id).eq("status", "active").single();
  if (orgError || !organization) throw Object.assign(new Error("Organisation ist nicht aktiv."), { status: 403 });
  const { data: snapshot, error: snapshotError } = await service.from("workspace_snapshots").select("state,revision").eq("organization_id", organization.id).single();
  if (snapshotError || !snapshot) throw Object.assign(new Error("Arbeitsbereich konnte nicht geladen werden."), { status: 404 });
  const state = snapshot.state && typeof snapshot.state === "object" ? snapshot.state : {};
  const admins = Array.isArray(state.admins) ? state.admins : [];
  const admin = session.role === "admin" ? admins.find((item: any) => item.id === session.subject_id && item.active !== false && item.status !== "revoked") : null;
  const accessRole = session.role === "admin" ? (admin?.scope === "owner" ? "owner" : "manager") : session.role;
  if (!admin || !["owner", "manager"].includes(accessRole)) throw Object.assign(new Error("Nur Inhaber oder Manager dürfen Schichten planen."), { status: 403 });
  let managerLocations: string[] = [];
  if (accessRole === "manager") {
    const { data: rows, error } = await service.from("manager_location_access").select("location_id").eq("organization_id", organization.id).eq("manager_id", session.subject_id);
    if (error) throw error;
    managerLocations = (rows || []).map((row: any) => String(row.location_id));
    if (!managerLocations.length) throw Object.assign(new Error("Für diesen Manager ist kein expliziter Standortzugriff eingerichtet."), { status: 403 });
  }
  return { token, session, organization, snapshot, state, admin, accessRole, managerLocations };
}
async function workRuleSummary(organizationId: string) {
  const now = Date.now();
  const cached = ruleSummaryCache.get(organizationId);
  if (cached && cached.expiresAt > now) return await cached.value;
  if (ruleSummaryCache.size >= 100) {
    const oldestKey = ruleSummaryCache.keys().next().value;
    if (oldestKey) ruleSummaryCache.delete(oldestKey);
  }
  const value = (async () => {
    const { data: set, error: setError } = await service.from("work_rule_sets").select("id,name,version,effective_from,effective_to,timezone").eq("organization_id", organizationId).eq("active", true).order("version", { ascending: false }).limit(1).maybeSingle();
    if (setError) throw setError;
    if (!set) return null;
    const { data: rules, error: rulesError } = await service.from("work_rules").select("rule_type,threshold_minutes,severity,parameters").eq("rule_set_id", set.id).eq("active", true).order("rule_type");
    if (rulesError) throw rulesError;
    return { ...set, rules: rules || [] };
  })();
  ruleSummaryCache.set(organizationId, { expiresAt: now + RULE_SUMMARY_TTL_MS, value });
  try {
    return await value;
  } catch (error) {
    ruleSummaryCache.delete(organizationId);
    throw error;
  }
}
function normalizeShift(input: any) {
  const shift = input && typeof input === "object" ? input : {};
  const breakMinutes = Number(shift.breakMinutes || 0);
  if (!shift.employeeId || !shift.locationId || !/^\d{4}-\d{2}-\d{2}$/.test(String(shift.date || "")) || !/^\d{2}:\d{2}/.test(String(shift.start || "")) || !/^\d{2}:\d{2}/.test(String(shift.end || "")) || !Number.isFinite(breakMinutes) || breakMinutes < 0) {
    throw Object.assign(new Error("Schichtdaten sind unvollständig oder ungültig."), { status: 400 });
  }
  return { ...shift, breakMinutes };
}
async function evaluate(ctx: any, shiftInput: any, ruleOverride: any = null) {
  const shift = normalizeShift(shiftInput);
  if (ctx.accessRole === "manager" && !ctx.managerLocations.includes(String(shift.locationId))) throw Object.assign(new Error("Kein Zugriff auf diesen Standort."), { status: 403 });
  const shifts = Array.isArray(ctx.state.shifts) ? ctx.state.shifts : [];
  const { data, error } = await service.rpc("aora_evaluate_shift_rules", {
    p_organization_id: ctx.organization.id,
    p_employee_id: String(shift.employeeId),
    p_location_id: String(shift.locationId),
    p_date: String(shift.date),
    p_start: String(shift.start),
    p_end: String(shift.end),
    p_break_minutes: Number(shift.breakMinutes || 0),
    p_existing_shifts: shifts,
    p_exclude_shift_id: shift.id || null,
    p_override_reason: ruleOverride?.confirmed === true ? String(ruleOverride.reason || "") : null,
    p_actor_type: ctx.accessRole,
    p_actor_id: ctx.session.subject_id,
  });
  if (error) throw error;
  return { shift, evaluation: data };
}

Deno.serve(async (request: Request) => {
  const origin = request.headers.get("origin");
  if (request.method === "OPTIONS") return new Response("ok", { headers: cors(origin) });
  if (request.method !== "POST") return reply({ error: "Method not allowed" }, 405, origin);
  if (origin && !allowedOrigin(origin)) return reply({ error: "Origin not allowed" }, 403, origin);
  const length = Number(request.headers.get("content-length") || 0);
  if (length > MAX_BODY_BYTES) return reply({ error: "Request too large" }, 413, origin);

  try {
    const body = await request.json();
    const token = String(body.token || "");
    if (token.length !== 64) return reply({ error: "Sitzungstoken fehlt." }, 401, origin);

    if (body.action === "apply" && INVITATION_EVENTS.has(body.event?.type)) {
      const invitation = await callInvitation(body);
      return reply(invitation.data, invitation.status, origin);
    }

    if (body.action === "load") {
      const upstream = await callUpstream(body, origin);
      if (!upstream.ok) return reply(upstream.data, upstream.status, origin);
      const organizationId = upstream.data?.session?.organizationId;
      const ruleEngine = organizationId ? await workRuleSummary(organizationId) : null;
      return reply({ ...upstream.data, ruleEngine }, upstream.status, origin);
    }

    if (body.action === "evaluateShift") {
      const ctx = await loadContext(token);
      const { evaluation } = await evaluate(ctx, body.shift, body.ruleOverride);
      return reply({ ruleEvaluation: evaluation }, 200, origin);
    }

    if (body.action === "apply" && body.event?.type === "REQUEST_LEAVE") {
      await repairEmployeeLeaveDefaults(token);
    }

    if (body.action === "apply" && SHIFT_EVENTS.has(body.event?.type)) {
      const ctx = await loadContext(token);
      const { shift, evaluation } = await evaluate(ctx, body.event.shift, body.event.ruleOverride);
      if (!evaluation?.valid) {
        const status = evaluation?.requiresConfirmation ? 428 : 422;
        return reply({ error: evaluation?.requiresConfirmation ? "Bestätigung und Begründung erforderlich." : "Schicht verletzt eine blockierende Arbeitszeitregel.", ruleEvaluation: evaluation }, status, origin);
      }
      const forwarded = {
        ...body,
        event: {
          ...body.event,
          shift: {
            ...shift,
            ruleSetId: evaluation.ruleSetId,
            ruleSetVersion: evaluation.ruleSetVersion,
            ruleEvaluationId: evaluation.evaluationId,
            ruleOverrides: evaluation.violations.filter((item: any) => item.overridden === true).map((item: any) => ({ rule: item.rule, reason: body.event.ruleOverride?.reason || null })),
          },
        },
      };
      const upstream = await callUpstream(forwarded, origin);
      return reply({ ...upstream.data, ruleEvaluation: evaluation }, upstream.status, origin);
    }

    if (body.action === "apply" && body.event?.type === "DECIDE_LEAVE") {
      const event = await enrichStoredLeaveDecision(token, body.event);
      const upstream = await callUpstream({ ...body, event }, origin);
      return reply(upstream.data, upstream.status, origin);
    }

    const upstream = await callUpstream(body, origin);
    return reply(upstream.data, upstream.status, origin);
  } catch (error: any) {
    return reply({ error: error instanceof Error ? error.message : String(error) }, Number(error?.status || 500), origin);
  }
});

