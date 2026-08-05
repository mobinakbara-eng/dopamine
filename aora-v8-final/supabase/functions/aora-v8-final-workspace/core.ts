import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import { appOriginForRequest } from "./origin.ts";

export const URL = Deno.env.get("SUPABASE_URL")!;
export const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
export const LEGACY_WORKSPACE = `${URL}/functions/v1/workspace`;
export const service = createClient(URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const ARRAY_KEYS = [
  "admins",
  "locations",
  "employees",
  "shifts",
  "timeEntries",
  "leaveRequests",
  "correctionRequests",
  "announcements",
  "notifications",
  "kioskDevices",
  "audit",
  "clockRequests",
  "availabilityRules",
  "shiftRequests",
  "checklistTemplates",
  "checklistAssignments",
  "dailyLogs",
  "timesheetPeriods",
  "staffingRequirements",
  "shiftFeedback",
  "shiftTemplates",
  "invitations",
];

export const now = () => new Date().toISOString();
export const id = (prefix: string) => `${prefix}_${crypto.randomUUID()}`;
export const clone = <T>(value: T): T => structuredClone(value);
export const emailOk = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);

export const allowedOrigin = (origin: string | null) => {
  if (!origin) return true;
  try {
    const url = new URL(origin);
    return url.hostname === "localhost" ||
      url.hostname === "127.0.0.1" ||
      url.hostname.endsWith(".vercel.app");
  } catch {
    return false;
  }
};

export const cors = (origin: string | null) => ({
  "Access-Control-Allow-Origin": origin && allowedOrigin(origin)
    ? origin
    : "https://aora-workforce.vercel.app",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Vary": "Origin",
});

export const reply = (
  body: unknown,
  status = 200,
  origin: string | null = null,
) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      ...cors(origin),
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });

export function normalize(input: any) {
  const state = input && typeof input === "object" ? clone(input) : {};
  for (const key of ARRAY_KEYS) {
    if (!Array.isArray(state[key])) state[key] = [];
  }
  state.company ||= {
    id: "co_1",
    name: "AoraAI Workforce",
    timezone: "Europe/Berlin",
    locale: "de-DE",
    currency: "EUR",
  };
  state.meta = { ...(state.meta || {}), variant: "isolated-v8-final" };
  return state;
}

export async function context(token: string) {
  const { data: sessions, error: sessionError } = await service.rpc(
    "validate_demo_session",
    { p_token: token },
  );
  if (sessionError || !sessions?.length) {
    throw Object.assign(new Error("Sitzung ist ungültig oder abgelaufen."), {
      status: 401,
    });
  }
  const session = sessions[0];

  const { data: organization, error: organizationError } = await service
    .from("organizations")
    .select("id,slug,status")
    .eq("id", session.organization_id)
    .eq("status", "active")
    .single();
  if (organizationError || !organization) {
    throw Object.assign(new Error("Organisation ist nicht aktiv."), { status: 403 });
  }

  const { data: snapshot, error: snapshotError } = await service
    .from("workspace_snapshots")
    .select("state,revision")
    .eq("organization_id", organization.id)
    .single();
  if (snapshotError || !snapshot) {
    throw new Error("Arbeitsbereich konnte nicht geladen werden.");
  }

  const state = normalize(snapshot.state);
  const admin = session.role === "admin"
    ? state.admins.find((item: any) =>
      item.id === session.subject_id &&
      item.active !== false &&
      item.status !== "revoked"
    )
    : null;
  const accessRole = session.role === "admin"
    ? (admin?.scope === "owner" ? "owner" : "manager")
    : session.role;
  if (session.role === "admin" && !admin) {
    throw Object.assign(new Error("Administrationszugang wurde deaktiviert."), {
      status: 403,
    });
  }

  let managerLocationIds: string[] = [];
  if (accessRole === "manager") {
    const { data: accessRows, error: accessError } = await service
      .from("manager_location_access")
      .select("location_id")
      .eq("organization_id", organization.id)
      .eq("manager_id", session.subject_id);
    if (accessError) throw accessError;
    managerLocationIds = (accessRows || []).map((row: any) => String(row.location_id));
    if (!managerLocationIds.length) {
      throw Object.assign(
        new Error("Für diesen Manager ist kein expliziter Standortzugriff eingerichtet."),
        { status: 403 },
      );
    }
  }

  return { session, organization, snapshot, state, admin, accessRole, managerLocationIds };
}

export function allowedLocations(ctx: any) {
  if (ctx.accessRole === "owner") {
    return new Set<string>(
      ctx.state.locations
        .filter((item: any) => item.active !== false)
        .map((item: any) => item.id),
    );
  }
  if (ctx.accessRole === "manager") {
    return new Set<string>(ctx.managerLocationIds);
  }
  if (ctx.session.location_id) return new Set<string>([ctx.session.location_id]);
  return new Set<string>();
}

export function scopeState(ctx: any, sourceInput: any) {
  const source = normalize(sourceInput);
  if (ctx.accessRole === "owner") return source;
  if (ctx.accessRole !== "manager") return source;

  const locations = allowedLocations(ctx);
  const employees = source.employees.filter((item: any) =>
    locations.has(item.locationId)
  );
  const employeeIds = new Set(employees.map((item: any) => item.id));
  const templateIds = new Set(
    source.checklistTemplates
      .filter((item: any) => !item.locationId || locations.has(item.locationId))
      .map((item: any) => item.id),
  );

  return {
    ...source,
    locations: source.locations.filter((item: any) => locations.has(item.id)),
    admins: source.admins.filter((item: any) => item.id === ctx.admin.id),
    employees,
    shifts: source.shifts.filter((item: any) => locations.has(item.locationId)),
    timeEntries: source.timeEntries.filter((item: any) =>
      locations.has(item.locationId)
    ),
    leaveRequests: source.leaveRequests.filter((item: any) =>
      employeeIds.has(item.employeeId)
    ),
    correctionRequests: source.correctionRequests.filter((item: any) =>
      employeeIds.has(item.employeeId)
    ),
    announcements: source.announcements.filter((item: any) =>
      item.audience === "all" || locations.has(item.audience)
    ),
    notifications: source.notifications.filter((item: any) =>
      employeeIds.has(item.employeeId) || locations.has(item.locationId)
    ),
    kioskDevices: source.kioskDevices.filter((item: any) =>
      locations.has(item.locationId)
    ),
    audit: source.audit
      .filter((item: any) =>
        !item.metadata?.locationId || locations.has(item.metadata.locationId)
      )
      .slice(0, 250),
    clockRequests: source.clockRequests.filter((item: any) =>
      locations.has(item.locationId)
    ),
    availabilityRules: source.availabilityRules.filter((item: any) =>
      employeeIds.has(item.employeeId)
    ),
    shiftRequests: source.shiftRequests.filter((item: any) =>
      locations.has(item.locationId) || employeeIds.has(item.employeeId)
    ),
    checklistTemplates: source.checklistTemplates.filter((item: any) =>
      templateIds.has(item.id)
    ),
    checklistAssignments: source.checklistAssignments.filter((item: any) =>
      locations.has(item.locationId)
    ),
    dailyLogs: source.dailyLogs.filter((item: any) =>
      locations.has(item.locationId)
    ),
    staffingRequirements: source.staffingRequirements.filter((item: any) =>
      locations.has(item.locationId)
    ),
    shiftFeedback: source.shiftFeedback.filter((item: any) =>
      employeeIds.has(item.employeeId)
    ),
    invitations: source.invitations.filter((item: any) =>
      item.invitedBy === ctx.admin.id ||
      (item.locationIds || [item.locationId]).some((locationId: string) =>
        locations.has(locationId)
      )
    ),
  };
}

function eventLocationIds(state: any, event: any): string[] {
  const values = new Set<string>();
  const add = (value: any) => {
    if (value) values.add(String(value));
  };

  add(event.locationId);
  add(event.shift?.locationId);
  add(event.employee?.locationId);
  add(event.patch?.locationId);
  add(event.assignment?.locationId);
  add(event.template?.locationId);
  if (event.announcement?.audience && event.announcement.audience !== "all") {
    add(event.announcement.audience);
  }

  const shift = state.shifts.find((item: any) =>
    item.id === event.id || item.id === event.shiftId
  );
  add(shift?.locationId);
  const employee = state.employees.find((item: any) =>
    item.id === event.id ||
    item.id === event.employeeId ||
    item.id === event.employee?.id
  );
  add(employee?.locationId);
  const entry = state.timeEntries.find((item: any) =>
    item.id === event.id || item.id === event.entryId
  );
  add(entry?.locationId);
  const leave = state.leaveRequests.find((item: any) => item.id === event.id);
  add(state.employees.find((item: any) => item.id === leave?.employeeId)?.locationId);
  const correction = state.correctionRequests.find((item: any) =>
    item.id === event.id
  );
  add(
    state.employees.find((item: any) => item.id === correction?.employeeId)
      ?.locationId,
  );
  const request = state.shiftRequests.find((item: any) => item.id === event.id);
  add(request?.locationId);
  const assignment = state.checklistAssignments.find((item: any) =>
    item.id === event.id || item.id === event.assignmentId
  );
  add(assignment?.locationId);
  const template = state.checklistTemplates.find((item: any) =>
    item.id === event.id || item.id === event.templateId
  );
  add(template?.locationId);
  const kiosk = state.kioskDevices.find((item: any) =>
    item.id === event.id || item.id === event.deviceId
  );
  add(kiosk?.locationId);
  return [...values];
}

function validGeofenceCoordinate(value: number, minimum: number, maximum: number) {
  return Number.isFinite(value) && value >= minimum && value <= maximum;
}

function configuredGeofencePosition(location: any) {
  const latitude = Number(location?.gps?.lat ?? location?.latitude);
  const longitude = Number(location?.gps?.lng ?? location?.longitude);
  if (
    !validGeofenceCoordinate(latitude, -90, 90) ||
    !validGeofenceCoordinate(longitude, -180, 180) ||
    (latitude === 0 && longitude === 0)
  ) return null;
  return { latitude, longitude };
}

function geofenceDistanceMeters(fromLatitude: number, fromLongitude: number, toLatitude: number, toLongitude: number) {
  const radians = (value: number) => value * Math.PI / 180;
  const earthRadius = 6_371_000;
  const latitudeDelta = radians(toLatitude - fromLatitude);
  const longitudeDelta = radians(toLongitude - fromLongitude);
  const value = Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(radians(fromLatitude)) * Math.cos(radians(toLatitude)) *
    Math.sin(longitudeDelta / 2) ** 2;
  return earthRadius * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value));
}

export function enforceApprovalGeofence(ctx: any, event: any) {
  if (event?.type !== "APPROVE_CLOCK_REQUEST") return;
  const request = ctx.state.clockRequests.find((item: any) =>
    item.id === event.id &&
    item.employeeId === ctx.session.subject_id &&
    item.status === "pending"
  );
  if (!request) {
    throw Object.assign(new Error("Die Kiosk-Anfrage ist nicht mehr aktiv."), { status: 409 });
  }
  const location = ctx.state.locations.find((item: any) =>
    item.id === request.locationId && item.active !== false
  );
  const configured = configuredGeofencePosition(location);
  if (!configured) {
    throw Object.assign(new Error("GPS fuer diesen Laden ist noch nicht eingerichtet. Bitte den Inhaber kontaktieren."), { status: 409 });
  }
  const position = event.position || {};
  const latitude = Number(position.lat);
  const longitude = Number(position.lng);
  const accuracy = Number(position.accuracy);
  const capturedAt = Date.parse(String(position.capturedAt || ""));
  if (
    !validGeofenceCoordinate(latitude, -90, 90) ||
    !validGeofenceCoordinate(longitude, -180, 180) ||
    !Number.isFinite(accuracy) ||
    accuracy < 0 ||
    !Number.isFinite(capturedAt) ||
    Math.abs(Date.now() - capturedAt) > 120_000
  ) {
    throw Object.assign(new Error("Der aktuelle GPS-Standort konnte nicht sicher bestaetigt werden."), { status: 422 });
  }
  const maxAccuracy = Math.max(10, Number(ctx.state.settings?.maxGpsAccuracy || 80));
  if (accuracy > maxAccuracy) {
    throw Object.assign(new Error(`GPS ist zu ungenau (${Math.round(accuracy)} m).`), { status: 422 });
  }
  const radius = Math.min(1000, Math.max(25, Number(
    location.geofenceRadius || ctx.state.settings?.defaultGeofenceRadius || 100,
  )));
  const distance = Math.round(geofenceDistanceMeters(
    configured.latitude,
    configured.longitude,
    latitude,
    longitude,
  ));
  if (distance > radius) {
    throw Object.assign(new Error(
      `Ausserhalb des Standorts (${distance} m entfernt, erlaubt: ${Math.round(radius)} m).`,
    ), { status: 403 });
  }
}

export function guardLegacyEvent(ctx: any, event: any) {
  if (!event?.type) {
    throw Object.assign(new Error("Aktion fehlt."), { status: 400 });
  }
  enforceApprovalGeofence(ctx, event);
  if (ctx.accessRole === "owner" || ctx.accessRole !== "manager") return event;

  const blocked = new Set([
    "RESET",
    "ADD_EMPLOYEE",
    "UPDATE_SETTINGS",
    "CLOSE_PAYROLL",
  ]);
  if (blocked.has(event.type)) {
    throw Object.assign(
      new Error("Diese Aktion ist nur für den Inhaber freigegeben."),
      { status: 403 },
    );
  }

  const locations = allowedLocations(ctx);
  const eventLocations = eventLocationIds(ctx.state, event);
  if (!eventLocations.length) {
    throw Object.assign(
      new Error("Der Standort dieser Aktion konnte nicht sicher bestimmt werden."),
      { status: 403 },
    );
  }
  if (eventLocations.some((locationId) => !locations.has(locationId))) {
    throw Object.assign(new Error("Kein Zugriff auf diesen Standort."), {
      status: 403,
    });
  }

  if (event.type === "ADD_ANNOUNCEMENT" && event.announcement?.audience === "all") {
    if (locations.size !== 1) {
      throw Object.assign(new Error("Bitte einen konkreten Standort auswählen."), {
        status: 400,
      });
    }
    return {
      ...event,
      announcement: { ...event.announcement, audience: [...locations][0] },
    };
  }
  if (event.type === "UPDATE_EMPLOYEE" && event.patch?.scope) {
    throw Object.assign(new Error("Rollenbereiche können hier nicht geändert werden."), {
      status: 403,
    });
  }
  return event;
}

export async function callLegacy(body: any) {
  const response = await fetch(LEGACY_WORKSPACE, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "authorization": `Bearer ${SERVICE_KEY}`,
      "apikey": SERVICE_KEY,
    },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  let data: any;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { error: text };
  }
  if (!response.ok) {
    throw Object.assign(
      new Error(data.error || data.message || `HTTP ${response.status}`),
      { status: response.status, data },
    );
  }
  return data;
}

export async function persist(
  ctx: any,
  state: any,
  eventType = "WORKSPACE_UPDATE",
  eventPayload: any = {},
) {
  const changedAt = now();
  const revision = Number(ctx.snapshot.revision) + 1;
  state.meta = {
    ...(state.meta || {}),
    revision,
    updatedAt: changedAt,
    variant: "isolated-v8-final",
  };

  const { data: committedRevision, error: commitError } = await service.rpc("aora_commit_workspace_state", {
    p_organization_id: ctx.organization.id,
    p_expected_revision: Number(ctx.snapshot.revision),
    p_state: state,
    p_actor_role: ctx.accessRole,
    p_actor_id: ctx.admin?.id || ctx.session.subject_id,
    p_event_type: eventType,
    p_event_payload: eventPayload && typeof eventPayload === "object" ? eventPayload : {},
  });
  if (commitError || Number(committedRevision) !== revision) {
    if (String(commitError?.message || "").includes("revision_conflict")) {
      throw Object.assign(
        new Error("Paralleländerung erkannt. Bitte Ansicht aktualisieren."),
        { status: 409 },
      );
    }
    throw commitError || new Error("Workspace konnte nicht gespeichert werden.");
  }
  return revision;
}

export function addAudit(
  state: any,
  ctx: any,
  action: string,
  entity: string,
  entityId: string,
  detail: string,
  metadata: any = null,
) {
  state.audit = [{
    id: id("audit"),
    action,
    actor: ctx.admin?.name || ctx.session.display_name || "Aora",
    entity,
    entityId,
    detail,
    metadata,
    createdAt: now(),
  }, ...(state.audit || [])].slice(0, 1000);
}

export async function sendInvite(
  origin: string | null,
  invitation: any,
  accessRole: "manager" | "employee",
) {
  const redirectOrigin = appOriginForRequest(origin);
  const route = accessRole === "manager" ? "arbeitgeber/" : "arbeitnehmer/";
  const redirectUrl = new globalThis.URL(`/${route}`, redirectOrigin);
  redirectUrl.searchParams.set("workspace", ctx.organization.slug);
  redirectUrl.searchParams.set("email_login", "1");
  redirectUrl.searchParams.set("invitation", invitation.id);
  const redirectTo = redirectUrl.toString();
  const { error } = await service.auth.signInWithOtp({
    email: invitation.email,
    options: { emailRedirectTo: redirectTo, shouldCreateUser: true },
  });
  return error
    ? { sent: false, error: error.message }
    : { sent: true, error: null };
}
