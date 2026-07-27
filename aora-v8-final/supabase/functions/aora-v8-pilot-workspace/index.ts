import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";

const URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const PRIMARY_PILOT_SLUG = "aora-v8-hardening-demo";
const HARDENING_WORKSPACE = `${URL}/functions/v1/aora-v8-hardening-workspace`;
const LEGACY_WORKSPACE = `${URL}/functions/v1/workspace`;
const DEFAULT_ORIGIN = "https://aora-v8-hardening.vercel.app";
const TEAM_PREVIEW_SUFFIX = "-mobins-projects-4f428afa.vercel.app";
const MAX_BODY_BYTES = 2_500_000;
const EXACT_ORIGINS = new Set([
  "https://aora-v8-hardening.vercel.app",
  "https://aora-v8-final.vercel.app",
  "https://aora-workforce.vercel.app",
]);
const ARRAY_KEYS = [
  "admins", "locations", "employees", "shifts", "timeEntries", "leaveRequests",
  "correctionRequests", "announcements", "notifications", "kioskDevices", "audit",
  "clockRequests", "availabilityRules", "shiftRequests", "checklistTemplates",
  "checklistAssignments", "dailyLogs", "timesheetPeriods", "staffingRequirements",
  "shiftFeedback", "shiftTemplates", "invitations",
];

const service = createClient(URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

function allowedOrigin(origin: string | null) {
  if (!origin) return true;
  if (EXACT_ORIGINS.has(origin)) return true;
  try {
    const parsed = new URL(origin);
    if (["localhost", "127.0.0.1"].includes(parsed.hostname)) return true;
    return parsed.protocol === "https:" && parsed.hostname.endsWith(TEAM_PREVIEW_SUFFIX);
  } catch {
    return false;
  }
}

function cors(origin: string | null) {
  const responseOrigin = origin && allowedOrigin(origin) ? origin : DEFAULT_ORIGIN;
  return {
    "Access-Control-Allow-Origin": responseOrigin,
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

function normalize(input: any) {
  const state = input && typeof input === "object" ? structuredClone(input) : {};
  for (const key of ARRAY_KEYS) if (!Array.isArray(state[key])) state[key] = [];
  state.meta = { ...(state.meta || {}), variant: "aora-8.1.0-pilot", tenantSource: "session" };
  return state;
}

async function callFunction(url: string, body: unknown) {
  const response = await fetch(url, {
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

async function loadContext(token: string) {
  const { data: sessions, error: sessionError } = await service.rpc("validate_demo_session", { p_token: token });
  if (sessionError || !sessions?.length) {
    throw Object.assign(new Error("Sitzung ist ungültig oder abgelaufen."), { status: 401 });
  }
  const session = sessions[0];
  const { data: organization, error: organizationError } = await service
    .from("organizations")
    .select("id,slug,name,status,timezone")
    .eq("id", session.organization_id)
    .eq("status", "active")
    .single();
  if (organizationError || !organization) {
    throw Object.assign(new Error("Organisation ist nicht aktiv oder wurde nicht gefunden."), { status: 403 });
  }
  const { data: snapshot, error: snapshotError } = await service
    .from("workspace_snapshots")
    .select("state,revision")
    .eq("organization_id", organization.id)
    .single();
  if (snapshotError || !snapshot) throw Object.assign(new Error("Arbeitsbereich konnte nicht geladen werden."), { status: 404 });

  const state = normalize(snapshot.state);
  const admin = session.role === "admin"
    ? state.admins.find((item: any) => item.id === session.subject_id && item.active !== false && item.status !== "revoked")
    : null;
  if (session.role === "admin" && !admin) {
    throw Object.assign(new Error("Administrationszugang wurde deaktiviert."), { status: 403 });
  }
  const accessRole = session.role === "admin" ? (admin?.scope === "owner" ? "owner" : "manager") : session.role;
  let managerLocationIds: string[] = [];
  if (accessRole === "manager") {
    const { data: rows, error } = await service
      .from("manager_location_access")
      .select("location_id")
      .eq("organization_id", organization.id)
      .eq("manager_id", session.subject_id);
    if (error) throw error;
    managerLocationIds = (rows || []).map((row: any) => String(row.location_id));
    if (!managerLocationIds.length) {
      managerLocationIds = (admin?.locationIds || [admin?.locationId]).filter(Boolean).map(String);
    }
  }
  return { session, organization, snapshot, state, admin, accessRole, managerLocationIds };
}

function allowedLocations(ctx: any) {
  if (ctx.accessRole === "owner") {
    return new Set<string>(ctx.state.locations.filter((item: any) => item.active !== false).map((item: any) => String(item.id)));
  }
  if (ctx.accessRole === "manager") return new Set<string>(ctx.managerLocationIds);
  if (ctx.session.location_id) return new Set<string>([String(ctx.session.location_id)]);
  return new Set<string>();
}

function scopeManagerState(ctx: any, sourceInput: any) {
  const source = normalize(sourceInput);
  if (ctx.accessRole === "owner") return source;
  if (ctx.accessRole !== "manager") return source;
  const locations = allowedLocations(ctx);
  const employees = source.employees.filter((item: any) => locations.has(String(item.locationId)));
  const employeeIds = new Set(employees.map((item: any) => String(item.id)));
  return {
    ...source,
    locations: source.locations.filter((item: any) => locations.has(String(item.id))),
    admins: source.admins.filter((item: any) => item.id === ctx.admin.id),
    employees,
    shifts: source.shifts.filter((item: any) => locations.has(String(item.locationId))),
    timeEntries: source.timeEntries.filter((item: any) => locations.has(String(item.locationId))),
    leaveRequests: source.leaveRequests.filter((item: any) => employeeIds.has(String(item.employeeId))),
    correctionRequests: source.correctionRequests.filter((item: any) => employeeIds.has(String(item.employeeId))),
    notifications: source.notifications.filter((item: any) => employeeIds.has(String(item.employeeId)) || locations.has(String(item.locationId))),
    kioskDevices: source.kioskDevices.filter((item: any) => locations.has(String(item.locationId))),
    clockRequests: source.clockRequests.filter((item: any) => locations.has(String(item.locationId))),
    availabilityRules: source.availabilityRules.filter((item: any) => employeeIds.has(String(item.employeeId))),
    shiftRequests: source.shiftRequests.filter((item: any) => employeeIds.has(String(item.employeeId)) || locations.has(String(item.locationId))),
    checklistAssignments: source.checklistAssignments.filter((item: any) => locations.has(String(item.locationId))),
    dailyLogs: source.dailyLogs.filter((item: any) => locations.has(String(item.locationId))),
    timesheetPeriods: [],
    staffingRequirements: source.staffingRequirements.filter((item: any) => locations.has(String(item.locationId))),
    shiftFeedback: source.shiftFeedback.filter((item: any) => employeeIds.has(String(item.employeeId))),
    shiftTemplates: source.shiftTemplates.filter((item: any) => !item.locationId || locations.has(String(item.locationId))),
    invitations: source.invitations.filter((item: any) =>
      item.kind === "employee" && (item.locationIds || [item.locationId]).some((locationId: string) => locations.has(String(locationId)))
    ),
    audit: source.audit.filter((item: any) => !item.metadata?.locationId || locations.has(String(item.metadata.locationId))).slice(0, 250),
  };
}

function eventLocationIds(state: any, event: any) {
  const values = new Set<string>();
  const add = (value: any) => { if (value != null && value !== "") values.add(String(value)); };
  add(event?.locationId);
  add(event?.shift?.locationId);
  add(event?.employee?.locationId);
  add(event?.patch?.locationId);
  add(event?.assignment?.locationId);
  add(state.shifts.find((item: any) => item.id === event?.id || item.id === event?.shiftId)?.locationId);
  add(state.employees.find((item: any) => item.id === event?.id || item.id === event?.employeeId)?.locationId);
  add(state.timeEntries.find((item: any) => item.id === event?.id || item.id === event?.entryId)?.locationId);
  return [...values];
}

function guardManagerEvent(ctx: any, event: any) {
  const locations = allowedLocations(ctx);
  const eventLocations = eventLocationIds(ctx.state, event);
  if (!event?.type || !eventLocations.length || eventLocations.some((locationId) => !locations.has(locationId))) {
    throw Object.assign(new Error("Kein Zugriff auf diesen Standort."), { status: 403 });
  }
}

Deno.serve(async (request: Request) => {
  const origin = request.headers.get("origin");
  if (request.method === "OPTIONS") return new Response("ok", { headers: cors(origin) });
  if (request.method !== "POST") return reply({ error: "Method not allowed" }, 405, origin);
  if (origin && !allowedOrigin(origin)) return reply({ error: "Origin not allowed" }, 403, origin);
  const contentLength = Number(request.headers.get("content-length") || 0);
  if (contentLength > MAX_BODY_BYTES) return reply({ error: "Request too large" }, 413, origin);

  try {
    const body = await request.json();
    const token = String(body.token || "");
    if (token.length !== 64) return reply({ error: "Sitzungstoken fehlt." }, 401, origin);
    const ctx = await loadContext(token);

    if (ctx.organization.slug === PRIMARY_PILOT_SLUG) {
      const result = await callFunction(HARDENING_WORKSPACE, body);
      return reply(result.data, result.status, origin);
    }

    const session = {
      organizationId: ctx.organization.id,
      organizationSlug: ctx.organization.slug,
      role: ctx.session.role,
      accessRole: ctx.accessRole,
      subjectId: ctx.session.subject_id,
      employeeId: ctx.session.role === "employee" ? ctx.session.subject_id : null,
      adminId: ctx.session.role === "admin" ? ctx.session.subject_id : null,
      deviceId: ctx.session.role === "kiosk" ? ctx.session.subject_id : null,
      locationId: ctx.session.location_id,
      locationIds: [...allowedLocations(ctx)],
      expiresAt: ctx.session.expires_at,
    };

    if (body.action === "load" && (ctx.accessRole === "owner" || ctx.accessRole === "manager")) {
      return reply({ state: scopeManagerState(ctx, ctx.state), revision: ctx.snapshot.revision, session }, 200, origin);
    }
    if (body.action === "apply" && ctx.accessRole === "manager") guardManagerEvent(ctx, body.event);
    if (body.action === "apply" && ctx.session.role === "kiosk") {
      return reply({ error: "Kiosk-Buchungen sind für neue Pilot-Tenants erst nach P0-2 freigeschaltet." }, 409, origin);
    }

    const legacy = await callFunction(LEGACY_WORKSPACE, body);
    if (!legacy.ok) return reply(legacy.data, legacy.status, origin);
    return reply({
      ...legacy.data,
      state: scopeManagerState(ctx, legacy.data.state),
      session: { ...(legacy.data.session || {}), ...session },
    }, 200, origin);
  } catch (error: any) {
    return reply({ error: error instanceof Error ? error.message : String(error) }, Number(error?.status || 500), origin);
  }
});