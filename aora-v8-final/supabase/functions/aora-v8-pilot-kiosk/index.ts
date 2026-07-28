import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";

const URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const MAX_BODY_BYTES = 2_500_000;
const DEFAULT_ORIGIN = "https://aora-v8-hardening.vercel.app";
const TEAM_PREVIEW_SUFFIX = "-mobins-projects-4f428afa.vercel.app";
const EXACT_ORIGINS = new Set([
  "https://aora-v8-hardening.vercel.app",
  "https://aora-v8-final.vercel.app",
  "https://aora-workforce.vercel.app",
]);
const TARGETS = new Set(["in", "out", "pause", "resume"]);
const ARRAYS = [
  "admins","locations","employees","shifts","timeEntries","leaveRequests","correctionRequests",
  "announcements","notifications","kioskDevices","audit","clockRequests","availabilityRules",
  "shiftRequests","checklistTemplates","checklistAssignments","dailyLogs","timesheetPeriods",
  "staffingRequirements","shiftFeedback","shiftTemplates","invitations",
];

const service = createClient(URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const now = () => new Date().toISOString();
const berlinDate = () => new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Berlin" }).format(new Date());
const berlinTime = () => new Intl.DateTimeFormat("de-DE", { timeZone: "Europe/Berlin", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date());

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
function response(body: unknown, status = 200, origin: string | null = null, replay = false) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...cors(origin),
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      "referrer-policy": "no-referrer",
      "x-aora-punch-replay": replay ? "true" : "false",
    },
  });
}
async function readBody(request: Request) {
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > MAX_BODY_BYTES) throw Object.assign(new Error("Request too large"), { status: 413 });
  try { return text ? JSON.parse(text) : {}; }
  catch { throw Object.assign(new Error("Ungültige Anfrage."), { status: 400 }); }
}
function normalize(input: any) {
  const state = input && typeof input === "object" ? structuredClone(input) : {};
  for (const key of ARRAYS) if (!Array.isArray(state[key])) state[key] = [];
  state.meta = { revision: 0, ...(state.meta || {}) };
  state.settings = {
    earlyClockMinutes: 15, lateClockMinutes: 30, clockPolicy: "warn",
    defaultGeofenceRadius: 100, maxGpsAccuracy: 80, ...(state.settings || {}),
  };
  return state;
}
function activeEntry(state: any, employeeId: string) {
  return state.timeEntries.find((entry: any) => entry.employeeId === employeeId && ["live", "paused"].includes(entry.status));
}
function scopeKiosk(state: any, session: any) {
  const employeeIds = new Set(state.employees.filter((item: any) => item.active !== false && item.locationId === session.location_id).map((item: any) => String(item.id)));
  const assignments = state.checklistAssignments.filter((item: any) => employeeIds.has(String(item.employeeId)) && item.date === berlinDate());
  const templateIds = new Set(assignments.map((item: any) => String(item.templateId)));
  return {
    ...state,
    admins: [],
    locations: state.locations.filter((item: any) => item.id === session.location_id),
    employees: state.employees.filter((item: any) => employeeIds.has(String(item.id))),
    shifts: state.shifts.filter((item: any) => item.locationId === session.location_id),
    timeEntries: state.timeEntries.filter((item: any) => item.locationId === session.location_id),
    leaveRequests: [], correctionRequests: [], notifications: [], announcements: [], audit: [],
    clockRequests: state.clockRequests.filter((item: any) => item.locationId === session.location_id),
    availabilityRules: [], shiftRequests: [],
    checklistAssignments: assignments,
    checklistTemplates: state.checklistTemplates.filter((item: any) => templateIds.has(String(item.id))),
    dailyLogs: [], timesheetPeriods: [], staffingRequirements: [], shiftFeedback: [],
    kioskDevices: state.kioskDevices.filter((item: any) => item.id === session.subject_id),
  };
}
function sessionPayload(session: any, organization: any) {
  return {
    organizationId: organization.id,
    organizationSlug: organization.slug,
    role: "kiosk",
    accessRole: "kiosk",
    subjectId: session.subject_id,
    employeeId: null,
    adminId: null,
    deviceId: session.subject_id,
    locationId: session.location_id,
    locationIds: [session.location_id],
    expiresAt: session.expires_at,
  };
}
async function context(token: string) {
  const { data: sessions, error: sessionError } = await service.rpc("validate_demo_session", { p_token: token });
  if (sessionError || !sessions?.length) throw Object.assign(new Error("Sitzung ist ungültig oder abgelaufen."), { status: 401 });
  const session = sessions[0];
  if (session.role !== "kiosk" || !session.location_id) throw Object.assign(new Error("Kiosk-Sitzung erforderlich."), { status: 403 });
  const { data: organization, error: orgError } = await service.from("organizations").select("id,slug,status").eq("id", session.organization_id).eq("status", "active").single();
  if (orgError || !organization) throw Object.assign(new Error("Organisation ist nicht aktiv."), { status: 403 });
  const { data: snapshot, error: snapshotError } = await service.from("workspace_snapshots").select("state,revision").eq("organization_id", organization.id).single();
  if (snapshotError || !snapshot) throw Object.assign(new Error("Arbeitsbereich konnte nicht geladen werden."), { status: 404 });
  return { session, organization, snapshot, state: normalize(snapshot.state) };
}
async function receipt(organizationId: string, eventId: string) {
  const { data } = await service.from("punch_events")
    .select("status,result_clock_request_id,result_time_entry_id,request_response_status,request_response_payload,approval_response_status,approval_response_payload,updated_at")
    .eq("organization_id", organizationId).eq("event_id", eventId).maybeSingle();
  return data;
}
async function waitForReceipt(organizationId: string, eventId: string) {
  for (let index = 0; index < 20; index += 1) {
    const row: any = await receipt(organizationId, eventId);
    if (row?.request_response_payload) return row;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  return await receipt(organizationId, eventId);
}
function buildClockRequest(state: any, event: any, session: any, eventId: string) {
  const employee = state.employees.find((item: any) => item.id === event.employeeId && item.locationId === session.location_id && item.active !== false && item.status !== "pending" && item.status !== "revoked");
  if (!employee) throw Object.assign(new Error("Mitarbeiter ist für dieses Kiosk nicht freigeschaltet."), { status: 403 });
  const device = state.kioskDevices.find((item: any) => item.id === session.subject_id && item.locationId === session.location_id && item.active !== false);
  if (!device || device.locked === true) throw Object.assign(new Error("Dieses Kiosk-Gerät ist gesperrt oder nicht aktiv."), { status: 423 });
  const targetRaw = String(event.target || "");
  if (!TARGETS.has(targetRaw)) throw Object.assign(new Error("Ungültiger Stempelstatus."), { status: 400 });
  const entry = activeEntry(state, employee.id);
  const target = targetRaw === "in" && entry?.status === "paused" ? "resume" : targetRaw;
  const allowed = !entry ? target === "in" : entry.status === "live" ? ["pause", "out"].includes(target) : ["resume", "out"].includes(target);
  if (!allowed) throw Object.assign(new Error("Dieser Statuswechsel ist aktuell nicht möglich."), { status: 409 });
  const date = berlinDate();
  const time = berlinTime();
  const shift = state.shifts.find((item: any) => item.employeeId === employee.id && item.date === date);
  const warnings: string[] = [];
  if (target === "in" && !shift) warnings.push("Keine veröffentlichte Schicht für heute");
  if (state.settings.clockPolicy === "block" && warnings.length) throw Object.assign(new Error(warnings[0]), { status: 409 });
  const createdAt = now();
  return {
    employee,
    request: {
      id: `clock_${eventId}`,
      clientEventId: eventId,
      employeeId: employee.id,
      locationId: session.location_id,
      deviceId: session.subject_id,
      target,
      status: "pending",
      date,
      time,
      shiftId: shift?.id || null,
      policyWarnings: warnings,
      createdAt,
      expiresAt: new Date(Date.now() + 90_000).toISOString(),
      version: 1,
    },
  };
}
function applyClockRequest(state: any, employee: any, clockRequest: any) {
  const changed = structuredClone(state);
  const timestamp = now();
  changed.clockRequests = [
    clockRequest,
    ...state.clockRequests
      .filter((item: any) => item.id !== clockRequest.id)
      .map((item: any) => item.employeeId === employee.id && item.status === "pending" ? { ...item, status: "expired", expiredAt: timestamp, version: Number(item.version || 0) + 1 } : item),
  ].slice(0, 500);
  const notificationKey = `clock:${clockRequest.id}`;
  if (!state.notifications.some((item: any) => item.key === notificationKey)) {
    changed.notifications = [{
      id: `note_${crypto.randomUUID()}`,
      key: notificationKey,
      employeeId: employee.id,
      title: "Kiosk-Anfrage",
      body: `${clockRequest.target === "in" ? "Einstempeln" : clockRequest.target === "out" ? "Ausstempeln" : clockRequest.target === "pause" ? "Pause starten" : "Pause beenden"} am Standort bestätigen.`,
      tone: "warning", read: false, createdAt: timestamp,
    }, ...state.notifications].slice(0, 500);
  }
  changed.audit = [{
    id: `audit_${crypto.randomUUID()}`,
    action: "clock.requested",
    actor: `Kiosk · ${clockRequest.deviceId}`,
    entity: "clock_request",
    entityId: clockRequest.id,
    detail: `${employee.name} · ${clockRequest.target}`,
    metadata: { eventId: clockRequest.clientEventId, locationId: clockRequest.locationId },
    createdAt: timestamp,
  }, ...state.audit].slice(0, 1000);
  changed.meta = { ...(changed.meta || {}), revision: Number(changed.meta?.revision || 0) + 1, updatedAt: timestamp, punchIdempotency: "durable-receipt" };
  return changed;
}
async function persist(ctx: any, changed: any) {
  const revision = Number(ctx.snapshot.revision) + 1;
  changed.meta.revision = revision;
  const { data: updated, error } = await service.from("workspace_snapshots")
    .update({ state: changed, revision, updated_at: now() })
    .eq("organization_id", ctx.organization.id)
    .eq("revision", ctx.snapshot.revision)
    .select("revision").maybeSingle();
  if (error || !updated) throw Object.assign(new Error("Paralleländerung erkannt. Bitte erneut versuchen."), { status: 409, retryable: true });
  const { error: projectionError } = await service.rpc("project_workspace_state", { p_organization_id: ctx.organization.id, p_state: changed });
  if (projectionError) throw projectionError;
  await service.from("workspace_changes").upsert({ organization_id: ctx.organization.id, revision, changed_at: now() });
  return revision;
}

Deno.serve(async (request: Request) => {
  const origin = request.headers.get("origin");
  if (request.method === "OPTIONS") return new Response("ok", { headers: cors(origin) });
  if (request.method !== "POST") return response({ error: "Method not allowed" }, 405, origin);
  if (origin && !allowedOrigin(origin)) return response({ error: "Origin not allowed" }, 403, origin);

  let organizationId = "";
  let eventId = "";
  try {
    const body = await readBody(request);
    const token = String(body.token || "");
    if (token.length !== 64) throw Object.assign(new Error("Sitzungstoken fehlt."), { status: 401 });
    const ctx = await context(token);
    organizationId = ctx.organization.id;

    if (body.action === "load") {
      return response({ state: scopeKiosk(ctx.state, ctx.session), revision: ctx.snapshot.revision, session: sessionPayload(ctx.session, ctx.organization) }, 200, origin);
    }
    if (body.action !== "apply" || body.event?.type !== "KIOSK_TRANSITION") throw Object.assign(new Error("Diese Aktion ist für das Kioskgerät nicht freigegeben."), { status: 403 });

    eventId = String(body.event.eventId || "");
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(eventId)) {
      throw Object.assign(new Error("Eine gültige event_id ist erforderlich."), { status: 400 });
    }
    const transition = String(body.event.target || "");
    const employeeId = String(body.event.employeeId || "");
    const { data: beginRows, error: beginError } = await service.rpc("aora_begin_punch", {
      p_organization_id: ctx.organization.id,
      p_event_id: eventId,
      p_employee_id: employeeId,
      p_location_id: ctx.session.location_id,
      p_device_id: ctx.session.subject_id,
      p_transition: transition,
      p_client_created_at: body.event.clientCreatedAt || null,
      p_client_timezone: body.event.clientTimezone || null,
      p_device_clock_offset: Number.isFinite(Number(body.event.deviceClockOffset)) ? Number(body.event.deviceClockOffset) : null,
    });
    if (beginError || !beginRows?.length) throw beginError || new Error("Punch receipt could not be created.");
    const begin = beginRows[0];
    if (begin.request_response_payload) return response({ ...begin.request_response_payload, idempotentReplay: true }, Number(begin.request_response_status || 200), origin, true);

    const recovered = ctx.state.clockRequests.find((item: any) => item.clientEventId === eventId || item.id === `clock_${eventId}`);
    if (recovered) {
      const payload = { state: scopeKiosk(ctx.state, ctx.session), revision: ctx.snapshot.revision, session: sessionPayload(ctx.session, ctx.organization), punch: { eventId, clockRequestId: recovered.id, status: recovered.status } };
      await service.rpc("aora_complete_punch_request", { p_organization_id: ctx.organization.id, p_event_id: eventId, p_clock_request_id: recovered.id, p_http_status: 200, p_payload: payload });
      return response({ ...payload, idempotentReplay: true }, 200, origin, true);
    }

    if (!begin.is_new) {
      const completed: any = await waitForReceipt(ctx.organization.id, eventId);
      if (completed?.request_response_payload) return response({ ...completed.request_response_payload, idempotentReplay: true }, Number(completed.request_response_status || 200), origin, true);
      return response({ pending: true, eventId, message: "Die Buchung wird bereits verarbeitet. Bitte nicht erneut stempeln." }, 202, origin, true);
    }

    const { employee, request: clockRequest } = buildClockRequest(ctx.state, body.event, ctx.session, eventId);
    const changed = applyClockRequest(ctx.state, employee, clockRequest);
    const revision = await persist(ctx, changed);
    const payload = { state: scopeKiosk(changed, ctx.session), revision, session: sessionPayload(ctx.session, ctx.organization), punch: { eventId, clockRequestId: clockRequest.id, status: "pending_confirmation" } };
    await service.rpc("aora_complete_punch_request", { p_organization_id: ctx.organization.id, p_event_id: eventId, p_clock_request_id: clockRequest.id, p_http_status: 200, p_payload: payload });
    return response(payload, 200, origin);
  } catch (error: any) {
    if (organizationId && eventId) {
      await service.rpc("aora_fail_punch", { p_organization_id: organizationId, p_event_id: eventId, p_error: error instanceof Error ? error.message : String(error), p_retryable: error?.retryable === true || Number(error?.status || 500) >= 500 });
    }
    return response({ error: error instanceof Error ? error.message : String(error) }, Number(error?.status || 500), origin);
  }
});