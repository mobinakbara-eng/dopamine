import "jsr:@supabase/functions-js/edge-runtime.d.ts";
// @ts-ignore remote Deno import
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";

const URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
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
const STRUCTURAL_TYPES = new Set([
  "ADD_LOCATION", "UPDATE_LOCATION", "ARCHIVE_LOCATION", "INVITE_MANAGER",
  "CREATE_EMPLOYEE_ACCOUNT", "RESEND_INVITATION", "REVOKE_INVITATION",
  "UPDATE_MANAGER_ACCESS", "DEACTIVATE_ACCOUNT", "CREATE_KIOSK_DEVICE",
  "ROTATE_KIOSK_ACTIVATION", "TOGGLE_KIOSK_LOCK",
]);
const MANAGER_LEGACY_TYPES = new Set([
  "ADD_SHIFT", "UPDATE_SHIFT", "DELETE_SHIFT", "COPY_WEEK", "PUBLISH_WEEK",
  "DECIDE_LEAVE", "UPDATE_TIME", "DECIDE_CORRECTION", "ADD_ANNOUNCEMENT",
  "UPDATE_EMPLOYEE", "RENEW_KIOSK", "DECIDE_SHIFT_REQUEST",
  "RUN_PLAN_ASSISTANT", "SET_STAFFING_REQUIREMENT", "CREATE_CHECKLIST_TEMPLATE",
  "ASSIGN_CHECKLIST", "DELETE_CHECKLIST_ASSIGNMENT", "ARCHIVE_CHECKLIST_TEMPLATE",
  "ADD_DAILY_LOG", "CREATE_SHIFT_TEMPLATE", "ACK_CLOCK_ALERT",
]);

const service = createClient(URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const now = () => new Date().toISOString();
const id = (prefix: string) => `${prefix}_${crypto.randomUUID()}`;
const clone = <T>(value: T): T => structuredClone(value);
const emailOk = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
const hex = (bytes: Uint8Array) => Array.from(bytes).map((byte) => byte.toString(16).padStart(2, "0")).join("");
function activationCode() {
  let value = "";
  while (value.length < 8) {
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    for (const byte of bytes) {
      if (byte < 250) value += String(byte % 10);
      if (value.length === 8) break;
    }
  }
  return value;
}
function locationGps(input: any, fallback: any = null) {
  const latitude = Number(input?.latitude ?? input?.gps?.lat ?? fallback?.gps?.lat ?? fallback?.latitude);
  const longitude = Number(input?.longitude ?? input?.gps?.lng ?? fallback?.gps?.lng ?? fallback?.longitude);
  if (
    !Number.isFinite(latitude) || latitude < -90 || latitude > 90 ||
    !Number.isFinite(longitude) || longitude < -180 || longitude > 180 ||
    (latitude === 0 && longitude === 0)
  ) {
    throw Object.assign(new Error("Gültige GPS-Koordinaten für den Laden sind erforderlich."), { status: 400 });
  }
  return {
    latitude,
    longitude,
    gps: { lat: latitude, lng: longitude },
    gpsConfigured: true,
  };
}

function allowedOrigin(origin: string | null) {
  if (!origin) return true;
  if (EXACT_ORIGINS.has(origin)) return true;
  try {
    const url = new globalThis.URL(origin);
    if (["localhost", "127.0.0.1"].includes(url.hostname)) return true;
    return url.protocol === "https:" && url.hostname.endsWith(TEAM_PREVIEW_SUFFIX);
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
  const state = input && typeof input === "object" ? clone(input) : {};
  for (const key of ARRAY_KEYS) if (!Array.isArray(state[key])) state[key] = [];
  state.company ||= {
    id: "co_1", name: "AoraAI Workforce", timezone: "Europe/Berlin", locale: "de-DE", currency: "EUR",
  };
  state.meta = { ...(state.meta || {}), variant: "isolated-v8-hardening" };
  return state;
}

async function context(token: string) {
  const { data: sessions, error: sessionError } = await service.rpc("validate_demo_session", { p_token: token });
  if (sessionError || !sessions?.length) {
    throw Object.assign(new Error("Sitzung ist ungültig oder abgelaufen."), { status: 401 });
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
  if (snapshotError || !snapshot) throw new Error("Arbeitsbereich konnte nicht geladen werden.");

  const state = normalize(snapshot.state);
  const admin = session.role === "admin"
    ? state.admins.find((item: any) => item.id === session.subject_id && item.active !== false && item.status !== "revoked")
    : null;
  const accessRole = session.role === "admin"
    ? (admin?.scope === "owner" ? "owner" : "manager")
    : session.role;
  if (session.role === "admin" && !admin) {
    throw Object.assign(new Error("Administrationszugang wurde deaktiviert."), { status: 403 });
  }
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
      throw Object.assign(new Error("Für diesen Manager ist kein expliziter Standortzugriff eingerichtet."), { status: 403 });
    }
  }
  return { session, organization, snapshot, state, admin, accessRole, managerLocationIds };
}

function allowedLocations(ctx: any) {
  if (ctx.accessRole === "owner") {
    return new Set<string>(ctx.state.locations.filter((item: any) => item.active !== false).map((item: any) => item.id));
  }
  if (ctx.accessRole === "manager") {
    return new Set<string>(ctx.managerLocationIds);
  }
  if (ctx.session.location_id) return new Set<string>([ctx.session.location_id]);
  return new Set<string>();
}

function scopeState(ctx: any, sourceInput: any) {
  const source = normalize(sourceInput);
  if (ctx.accessRole === "owner") return source;
  if (ctx.accessRole !== "manager") return source;

  const locations = allowedLocations(ctx);
  const employees = source.employees.filter((item: any) => locations.has(item.locationId));
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
    timeEntries: source.timeEntries.filter((item: any) => locations.has(item.locationId)),
    leaveRequests: source.leaveRequests.filter((item: any) => employeeIds.has(item.employeeId)),
    correctionRequests: source.correctionRequests.filter((item: any) => employeeIds.has(item.employeeId)),
    announcements: source.announcements.filter((item: any) => item.audience === "all" || locations.has(item.audience)),
    notifications: source.notifications.filter((item: any) => employeeIds.has(item.employeeId) || locations.has(item.locationId)),
    kioskDevices: source.kioskDevices.filter((item: any) => locations.has(item.locationId)),
    audit: source.audit.filter((item: any) => !item.metadata?.locationId || locations.has(item.metadata.locationId)).slice(0, 250),
    clockRequests: source.clockRequests.filter((item: any) => locations.has(item.locationId)),
    availabilityRules: source.availabilityRules.filter((item: any) => employeeIds.has(item.employeeId)),
    shiftRequests: source.shiftRequests.filter((item: any) => locations.has(item.locationId) || employeeIds.has(item.employeeId)),
    checklistTemplates: source.checklistTemplates.filter((item: any) => templateIds.has(item.id)),
    checklistAssignments: source.checklistAssignments.filter((item: any) => locations.has(item.locationId)),
    dailyLogs: source.dailyLogs.filter((item: any) => locations.has(item.locationId)),
    timesheetPeriods: [],
    staffingRequirements: source.staffingRequirements.filter((item: any) => locations.has(item.locationId)),
    shiftFeedback: source.shiftFeedback.filter((item: any) => employeeIds.has(item.employeeId)),
    shiftTemplates: source.shiftTemplates.filter((item: any) => !item.locationId || locations.has(item.locationId)),
    invitations: source.invitations.filter((item: any) =>
      item.kind === "employee" &&
      (item.locationIds || [item.locationId]).some((locationId: string) => locations.has(locationId))
    ),
  };
}

function eventLocationIds(state: any, event: any) {
  const values = new Set<string>();
  const add = (value: any) => { if (value) values.add(String(value)); };
  add(event.locationId);
  add(event.shift?.locationId);
  add(event.employee?.locationId);
  add(event.patch?.locationId);
  add(event.assignment?.locationId);
  add(event.template?.locationId);
  add(event.requirement?.locationId);
  add(event.log?.locationId);
  if (event.announcement?.audience && event.announcement.audience !== "all") add(event.announcement.audience);
  add(state.shifts.find((item: any) => item.id === event.id || item.id === event.shiftId)?.locationId);
  add(state.employees.find((item: any) => item.id === event.id || item.id === event.employeeId || item.id === event.employee?.id)?.locationId);
  add(state.timeEntries.find((item: any) => item.id === event.id || item.id === event.entryId)?.locationId);
  const leave = state.leaveRequests.find((item: any) => item.id === event.id);
  add(state.employees.find((item: any) => item.id === leave?.employeeId)?.locationId);
  const correction = state.correctionRequests.find((item: any) => item.id === event.id);
  add(state.employees.find((item: any) => item.id === correction?.employeeId)?.locationId);
  add(state.shiftRequests.find((item: any) => item.id === event.id)?.locationId);
  add(state.checklistAssignments.find((item: any) => item.id === event.id || item.id === event.assignmentId)?.locationId);
  add(state.checklistTemplates.find((item: any) => item.id === event.id || item.id === event.templateId)?.locationId);
  add(state.kioskDevices.find((item: any) => item.id === event.id || item.id === event.deviceId)?.locationId);
  return [...values];
}

function guardManagerEvent(ctx: any, event: any) {
  if (!event?.type) throw Object.assign(new Error("Aktion fehlt."), { status: 400 });
  if (!MANAGER_LEGACY_TYPES.has(event.type)) {
    throw Object.assign(new Error("Diese Aktion ist für Manager nicht freigegeben."), { status: 403 });
  }
  const locations = allowedLocations(ctx);
  const eventLocations = eventLocationIds(ctx.state, event);
  if (!eventLocations.length) {
    throw Object.assign(new Error("Der Standort dieser Aktion konnte nicht sicher bestimmt werden."), { status: 403 });
  }
  if (eventLocations.some((locationId) => !locations.has(locationId))) {
    throw Object.assign(new Error("Kein Zugriff auf diesen Standort."), { status: 403 });
  }
  if (event.type === "ADD_ANNOUNCEMENT" && event.announcement?.audience === "all") {
    if (locations.size !== 1) {
      throw Object.assign(new Error("Bitte einen konkreten Standort auswählen."), { status: 400 });
    }
    return { ...event, announcement: { ...event.announcement, audience: [...locations][0] } };
  }
  if (event.type === "UPDATE_EMPLOYEE" && (event.patch?.scope || event.patch?.locationIds)) {
    throw Object.assign(new Error("Rollenbereiche können hier nicht geändert werden."), { status: 403 });
  }
  return event;
}

function mapKioskTransition(ctx: any, event: any) {
  if (ctx.session.role !== "kiosk" || event?.type !== "KIOSK_TRANSITION") return event;
  const employeeId = String(event.employeeId || "");
  const employee = ctx.state.employees.find((item: any) => item.id === employeeId && item.active !== false);
  if (!employee || employee.locationId !== ctx.session.location_id) {
    throw Object.assign(new Error("Mitarbeiter ist für dieses Kiosk nicht verfügbar."), { status: 403 });
  }
  const active = ctx.state.timeEntries.find((item: any) =>
    item.employeeId === employeeId && ["live", "paused"].includes(item.status)
  );
  let target = String(event.target || "");
  if (target === "in" && active?.status === "paused") target = "resume";
  return { type: "REQUEST_CLOCK", employeeId, target };
}

async function callLegacy(body: any) {
  const response = await fetch(LEGACY_WORKSPACE, {
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
  if (!response.ok) {
    throw Object.assign(new Error(data.error || data.message || `HTTP ${response.status}`), {
      status: response.status,
      data,
    });
  }
  return data;
}

async function persist(ctx: any, state: any) {
  const changedAt = now();
  const revision = Number(ctx.snapshot.revision) + 1;
  state.meta = { ...(state.meta || {}), revision, updatedAt: changedAt, variant: "isolated-v8-hardening" };
  const { data: updated, error: updateError } = await service
    .from("workspace_snapshots")
    .update({ state, revision, updated_at: changedAt })
    .eq("organization_id", ctx.organization.id)
    .eq("revision", ctx.snapshot.revision)
    .select("revision")
    .maybeSingle();
  if (updateError || !updated) {
    throw Object.assign(new Error("Paralleländerung erkannt. Bitte Ansicht aktualisieren."), { status: 409 });
  }
  await service.from("workspace_changes").upsert({
    organization_id: ctx.organization.id,
    revision,
    changed_at: changedAt,
  });
  return revision;
}

async function persistKioskActivation(ctx: any, state: any, activation: any) {
  const changedAt = now();
  const revision = Number(ctx.snapshot.revision) + 1;
  state.meta = { ...(state.meta || {}), revision, updatedAt: changedAt, variant: "isolated-v8-hardening" };
  const { data, error } = await service.rpc("aora_commit_kiosk_activation", {
    p_organization_id: ctx.organization.id,
    p_expected_revision: Number(ctx.snapshot.revision),
    p_state: state,
    p_actor_role: ctx.accessRole,
    p_actor_id: ctx.admin.id,
    p_event_type: activation.eventType,
    p_device_id: activation.deviceId,
    p_device_name: activation.deviceName,
    p_location_id: activation.locationId,
    p_activation_code: activation.code,
    p_event_payload: { deviceId: activation.deviceId, locationId: activation.locationId },
  });
  if (error || Number(data) !== revision) {
    if (String(error?.message || "").includes("revision_conflict")) {
      throw Object.assign(new Error("Paralleländerung erkannt. Bitte Ansicht aktualisieren."), { status: 409 });
    }
    throw error || new Error("Kiosk-Aktivierung konnte nicht gespeichert werden.");
  }
  return revision;
}

function addAudit(state: any, ctx: any, action: string, entity: string, entityId: string, detail: string, metadata: any = null) {
  state.audit = [{
    id: id("audit"), action, actor: ctx.admin?.name || ctx.session.display_name || "Aora",
    entity, entityId, detail, metadata, createdAt: now(),
  }, ...(state.audit || [])].slice(0, 1000);
}

function requireOwner(ctx: any, message: string) {
  if (ctx.accessRole !== "owner") throw Object.assign(new Error(message), { status: 403 });
}

function requireLocation(state: any, locationId: string) {
  if (!state.locations.some((item: any) => item.id === locationId && item.active !== false)) {
    throw Object.assign(new Error("Laden wurde nicht gefunden."), { status: 404 });
  }
}

function ensureEmailAvailable(state: any, email: string) {
  const used = [...state.admins, ...state.employees].some((item: any) =>
    String(item.email || "").toLowerCase() === email && item.status !== "revoked"
  );
  const pending = state.invitations.some((item: any) =>
    String(item.email || "").toLowerCase() === email && item.status === "pending"
  );
  if (used || pending) {
    throw Object.assign(new Error("Diese E-Mail-Adresse besitzt bereits einen Zugang oder eine offene Einladung."), { status: 409 });
  }
}

function invitationLocations(invitation: any) {
  return (invitation.locationIds || [invitation.locationId]).filter(Boolean);
}

function requireInvitationAccess(ctx: any, invitation: any) {
  if (ctx.accessRole !== "manager") return;
  const locations = allowedLocations(ctx);
  if (
    invitation.kind !== "employee" ||
    !invitationLocations(invitation).some((locationId: string) => locations.has(locationId))
  ) {
    throw Object.assign(new Error("Kein Zugriff auf diese Einladung."), { status: 403 });
  }
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return hex(new Uint8Array(digest));
}

async function issueInvitationToken(ctx: any, invitation: any, accessRole: "manager" | "employee", origin: string | null) {
  const token = hex(crypto.getRandomValues(new Uint8Array(32)));
  const issuedAt = now();
  const { error } = await service.from("aora_v8_final_invitation_tokens").upsert({
    organization_id: ctx.organization.id,
    invitation_id: invitation.id,
    token_hash: await sha256(token),
    expires_at: invitation.expiresAt,
    used_at: null,
    revoked_at: null,
    updated_at: issuedAt,
  }, { onConflict: "organization_id,invitation_id" });
  if (error) throw error;

  const appOrigin = origin && allowedOrigin(origin) ? origin : DEFAULT_ORIGIN;
  const route = accessRole === "manager" ? "arbeitgeber/" : "arbeitnehmer/";
  const inviteUrl = new globalThis.URL(`/${route}`, appOrigin);
  inviteUrl.searchParams.set("workspace", ctx.organization.slug);
  inviteUrl.searchParams.set("invitation", invitation.id);
  inviteUrl.searchParams.set("token", token);
  const roleLabel = accessRole === "manager" ? "Manager / Arbeitgeber" : "Mitarbeiter";
  const subject = `Einladung zu ${ctx.state.company?.name || "AoraAI Workforce"}`;
  const body = [
    `Hallo ${invitation.name},`, "",
    `du wurdest als ${roleLabel} zu ${ctx.state.company?.name || "AoraAI Workforce"} eingeladen.`,
    "Öffne den folgenden einmaligen Link und lege dein persönliches Passwort fest:", "",
    inviteUrl.toString(), "",
    `Der Link ist bis ${new Intl.DateTimeFormat("de-DE", {
      dateStyle: "medium", timeStyle: "short", timeZone: ctx.state.company?.timezone || "Europe/Berlin",
    }).format(new Date(invitation.expiresAt))} gültig.`, "",
    "Falls du diese Einladung nicht erwartest, kannst du die E-Mail ignorieren.",
  ].join("\n");
  return { invitationId: invitation.id, email: invitation.email, name: invitation.name, accessRole, inviteUrl: inviteUrl.toString(), subject, body, expiresAt: invitation.expiresAt };
}

async function revokeInvitationToken(ctx: any, invitationId: string) {
  const timestamp = now();
  const { error } = await service.from("aora_v8_final_invitation_tokens")
    .update({ revoked_at: timestamp, updated_at: timestamp })
    .eq("organization_id", ctx.organization.id)
    .eq("invitation_id", invitationId);
  if (error) throw error;
}

async function applyStructural(ctx: any, event: any, expectedRevision: number, origin: string | null) {
  if (Number(expectedRevision) !== Number(ctx.snapshot.revision)) {
    throw Object.assign(new Error("Daten wurden auf einem anderen Gerät geändert."), { status: 409 });
  }
  if (!new Set(["owner", "manager"]).has(ctx.accessRole)) {
    throw Object.assign(new Error("Verwaltungszugang erforderlich."), { status: 403 });
  }
  const state = clone(ctx.state);
  let invitation: any = null;
  let inviteRole: "manager" | "employee" | null = null;
  let revokeTokenId: string | null = null;
  let kioskActivation: any = null;
  const postCommit: Array<() => Promise<unknown>> = [];

  switch (event.type) {
    case "ADD_LOCATION": {
      requireOwner(ctx, "Nur der Inhaber kann einen Laden anlegen.");
      const input = event.location || {};
      const name = String(input.name || "").trim();
      const city = String(input.city || "").trim();
      if (name.length < 2 || city.length < 2) {
        throw Object.assign(new Error("Name und Stadt sind erforderlich."), { status: 400 });
      }
      if (state.locations.some((item: any) =>
        item.active !== false && String(item.name).toLowerCase() === name.toLowerCase() && String(item.city).toLowerCase() === city.toLowerCase()
      )) {
        throw Object.assign(new Error("Dieser Laden existiert bereits."), { status: 409 });
      }
      const gps = locationGps(input);
      const location = {
        id: id("loc"), name, city, address: String(input.address || "").trim(),
        country: String(input.country || "Deutschland").trim(),
        timezone: String(input.timezone || state.company.timezone || "Europe/Berlin"),
        costCenter: String(input.costCenter || "").trim(),
        geofenceRadius: Math.min(1000, Math.max(25, Number(input.geofenceRadius || 100))),
        ...gps,
        active: true, createdAt: now(), createdBy: ctx.admin.id,
      };
      state.locations.push(location);
      state.admins = state.admins.map((admin: any) => admin.scope === "owner"
        ? { ...admin, locationIds: [...new Set([...(admin.locationIds || []), location.id])] }
        : admin);
      addAudit(state, ctx, "location.created", "location", location.id, `${location.name} · ${location.city}`, { locationId: location.id });
      break;
    }
    case "UPDATE_LOCATION": {
      requireOwner(ctx, "Nur der Inhaber kann Ladendaten ändern.");
      const current = state.locations.find((item: any) => item.id === event.id);
      if (!current) throw Object.assign(new Error("Laden wurde nicht gefunden."), { status: 404 });
      const patch = event.patch || {};
      const gps = locationGps(patch, current);
      const allowedPatch = {
        name: patch.name == null ? current.name : String(patch.name).trim(),
        city: patch.city == null ? current.city : String(patch.city).trim(),
        address: patch.address == null ? current.address : String(patch.address).trim(),
        country: patch.country == null ? current.country : String(patch.country).trim(),
        timezone: patch.timezone == null ? current.timezone : String(patch.timezone),
        costCenter: patch.costCenter == null ? current.costCenter : String(patch.costCenter).trim(),
        geofenceRadius: patch.geofenceRadius == null ? current.geofenceRadius : Math.min(1000, Math.max(25, Number(patch.geofenceRadius))),
        ...gps,
      };
      if (allowedPatch.name.length < 2 || allowedPatch.city.length < 2) {
        throw Object.assign(new Error("Name und Stadt sind erforderlich."), { status: 400 });
      }
      state.locations = state.locations.map((item: any) => item.id === current.id
        ? { ...item, ...allowedPatch, id: item.id, active: item.active, updatedAt: now(), updatedBy: ctx.admin.id }
        : item);
      addAudit(state, ctx, "location.updated", "location", current.id, current.name, { locationId: current.id });
      break;
    }
    case "ARCHIVE_LOCATION": {
      requireOwner(ctx, "Nur der Inhaber kann einen Laden archivieren.");
      const current = state.locations.find((item: any) => item.id === event.id && item.active !== false);
      if (!current) throw Object.assign(new Error("Aktiver Laden wurde nicht gefunden."), { status: 404 });
      if (state.employees.some((item: any) => item.locationId === current.id && item.active !== false)) {
        throw Object.assign(new Error("Aktive Mitarbeiter müssen zuerst versetzt oder deaktiviert werden."), { status: 409 });
      }
      state.locations = state.locations.map((item: any) => item.id === current.id
        ? { ...item, active: false, archivedAt: now(), archivedBy: ctx.admin.id }
        : item);
      state.admins = state.admins.map((admin: any) => ({
        ...admin, locationIds: (admin.locationIds || []).filter((locationId: string) => locationId !== current.id),
      }));
      addAudit(state, ctx, "location.archived", "location", current.id, current.name, { locationId: current.id });
      break;
    }
    case "INVITE_MANAGER": {
      requireOwner(ctx, "Nur der Inhaber kann Manager einladen.");
      const input = event.manager || {};
      const name = String(input.name || "").trim();
      const email = String(input.email || "").trim().toLowerCase();
      const locationIds: string[] = [...new Set<string>((input.locationIds || []).map((value: unknown) => String(value)))];
      if (name.length < 2 || !emailOk(email) || !locationIds.length) {
        throw Object.assign(new Error("Name, gültige E-Mail und mindestens ein Laden sind erforderlich."), { status: 400 });
      }
      for (const locationId of locationIds) requireLocation(state, locationId);
      ensureEmailAvailable(state, email);
      const manager = {
        id: id("admin"), name, email, role: "Manager", scope: "manager", locationIds,
        active: true, status: "pending",
        initials: name.split(/\s+/).slice(0, 2).map((part: string) => part[0]).join("").toUpperCase(),
        createdAt: now(), invitedBy: ctx.admin.id,
      };
      invitation = {
        id: id("invite"), kind: "manager", subjectId: manager.id, name, email, locationIds,
        status: "pending", invitedBy: ctx.admin.id, createdAt: now(),
        expiresAt: new Date(Date.now() + 7 * 86_400_000).toISOString(), emailStatus: "prepared",
      };
      state.admins.push(manager);
      state.invitations.unshift(invitation);
      inviteRole = "manager";
      addAudit(state, ctx, "manager.invited", "admin", manager.id, `${name} · ${email}`, { locationIds });
      break;
    }
    case "CREATE_EMPLOYEE_ACCOUNT": {
      const input = event.employee || {};
      const name = String(input.name || "").trim();
      const email = String(input.email || "").trim().toLowerCase();
      const locationId = String(input.locationId || "");
      if (name.length < 2 || !emailOk(email) || !locationId) {
        throw Object.assign(new Error("Name, gültige E-Mail und Laden sind erforderlich."), { status: 400 });
      }
      requireLocation(state, locationId);
      if (ctx.accessRole === "manager" && !allowedLocations(ctx).has(locationId)) {
        throw Object.assign(new Error("Du darfst nur Mitarbeiter deiner eigenen Läden anlegen."), { status: 403 });
      }
      ensureEmailAvailable(state, email);
      const employee = {
        id: id("emp"), name, email, role: String(input.role || "Mitarbeiter").trim(), locationId,
        allowedLocationIds: [locationId], weeklyTarget: Math.min(60, Math.max(0, Number(input.weeklyTarget || 40))),
        vacationAllowance: Math.min(60, Math.max(0, Number(input.vacationAllowance || 27.5))),
        vacationUsed: 0, hourlyCost: Math.max(0, Number(input.hourlyCost || 0)),
        skills: Array.isArray(input.skills) ? input.skills.map(String).slice(0, 30) : [],
        active: true, status: "pending",
        initials: name.split(/\s+/).slice(0, 2).map((part: string) => part[0]).join("").toUpperCase(),
        createdAt: now(), invitedBy: ctx.admin.id,
      };
      invitation = {
        id: id("invite"), kind: "employee", subjectId: employee.id, name, email,
        locationId, locationIds: [locationId], status: "pending", invitedBy: ctx.admin.id,
        createdAt: now(), expiresAt: new Date(Date.now() + 7 * 86_400_000).toISOString(), emailStatus: "prepared",
      };
      state.employees.push(employee);
      state.invitations.unshift(invitation);
      inviteRole = "employee";
      addAudit(state, ctx, "employee.invited", "employee", employee.id, `${name} · ${email}`, { locationId });
      break;
    }
    case "RESEND_INVITATION": {
      const current = state.invitations.find((item: any) => item.id === event.id && item.status === "pending");
      if (!current) throw Object.assign(new Error("Offene Einladung wurde nicht gefunden."), { status: 404 });
      requireInvitationAccess(ctx, current);
      invitation = {
        ...current, expiresAt: new Date(Date.now() + 7 * 86_400_000).toISOString(),
        emailStatus: "prepared", resentAt: now(),
      };
      state.invitations = state.invitations.map((item: any) => item.id === current.id ? invitation : item);
      inviteRole = current.kind === "manager" ? "manager" : "employee";
      addAudit(state, ctx, "invitation.prepared_again", "invitation", current.id, current.email);
      break;
    }
    case "REVOKE_INVITATION": {
      const current = state.invitations.find((item: any) => item.id === event.id && item.status === "pending");
      if (!current) throw Object.assign(new Error("Offene Einladung wurde nicht gefunden."), { status: 404 });
      requireInvitationAccess(ctx, current);
      revokeTokenId = current.id;
      state.invitations = state.invitations.map((item: any) => item.id === current.id
        ? { ...item, status: "revoked", revokedAt: now(), revokedBy: ctx.admin.id }
        : item);
      if (current.kind === "manager") {
        state.admins = state.admins.map((item: any) => item.id === current.subjectId
          ? { ...item, active: false, status: "revoked", revokedAt: now() }
          : item);
      } else {
        state.employees = state.employees.map((item: any) => item.id === current.subjectId
          ? { ...item, active: false, status: "revoked", revokedAt: now() }
          : item);
      }
      addAudit(state, ctx, "invitation.revoked", "invitation", current.id, current.email);
      break;
    }
    case "UPDATE_MANAGER_ACCESS": {
      requireOwner(ctx, "Nur der Inhaber kann Manager-Rechte ändern.");
      const manager = state.admins.find((item: any) => item.id === event.id && item.scope === "manager" && item.status !== "revoked");
      if (!manager) throw Object.assign(new Error("Manager wurde nicht gefunden."), { status: 404 });
      const locationIds: string[] = [...new Set<string>((event.locationIds || []).map((value: unknown) => String(value)))];
      if (!locationIds.length) throw Object.assign(new Error("Mindestens ein gültiger Laden ist erforderlich."), { status: 400 });
      for (const locationId of locationIds) requireLocation(state, locationId);
      state.admins = state.admins.map((item: any) => item.id === manager.id
        ? { ...item, locationIds, updatedAt: now(), updatedBy: ctx.admin.id }
        : item);
      postCommit.push(async () => {
        await service.from("app_sessions").update({ revoked_at: now() })
          .eq("organization_id", ctx.organization.id).eq("role", "admin").eq("subject_id", manager.id);
      });
      addAudit(state, ctx, "manager.access_updated", "admin", manager.id, manager.name, { locationIds });
      break;
    }
    case "DEACTIVATE_ACCOUNT": {
      const kind = String(event.kind || "");
      if (!new Set(["manager", "employee"]).has(kind)) {
        throw Object.assign(new Error("Kontotyp ist ungültig."), { status: 400 });
      }
      const subjectRole = kind === "manager" ? "admin" : "employee";
      const collection = kind === "manager" ? "admins" : "employees";
      const account = state[collection].find((item: any) => item.id === event.id);
      if (!account || (kind === "manager" && account.scope !== "manager")) {
        throw Object.assign(new Error("Konto wurde nicht gefunden."), { status: 404 });
      }
      if (kind === "manager") requireOwner(ctx, "Nur der Inhaber kann Manager deaktivieren.");
      else if (ctx.accessRole === "manager" && !allowedLocations(ctx).has(account.locationId)) {
        throw Object.assign(new Error("Kein Zugriff auf diesen Mitarbeiter."), { status: 403 });
      }
      state[collection] = state[collection].map((item: any) => item.id === account.id
        ? { ...item, active: false, status: "revoked", revokedAt: now(), revokedBy: ctx.admin.id }
        : item);
      postCommit.push(async () => {
        const timestamp = now();
        await service.from("app_sessions").update({ revoked_at: timestamp })
          .eq("organization_id", ctx.organization.id).eq("role", subjectRole).eq("subject_id", account.id);
        await service.from("aora_v8_final_credentials").update({ active: false, updated_at: timestamp })
          .eq("organization_id", ctx.organization.id).eq("subject_role", subjectRole).eq("subject_id", account.id);
      });
      addAudit(state, ctx, `${kind}.deactivated`, subjectRole, account.id, account.name, account.locationId ? { locationId: account.locationId } : null);
      break;
    }
    case "CREATE_KIOSK_DEVICE": {
      const name = String(event.name || "").trim();
      const locationId = String(event.locationId || "");
      if (name.length < 2 || name.length > 80 || !locationId) {
        throw Object.assign(new Error("Gerätename und Laden sind erforderlich."), { status: 400 });
      }
      requireLocation(state, locationId);
      if (ctx.accessRole === "manager" && !allowedLocations(ctx).has(locationId)) {
        throw Object.assign(new Error("Du darfst Kiosk-Geräte nur für deine eigenen Läden anlegen."), { status: 403 });
      }
      if (state.kioskDevices.filter((item: any) => item.locationId === locationId && item.active !== false).length >= 10) {
        throw Object.assign(new Error("Für diesen Laden sind bereits zehn aktive Kiosk-Geräte eingerichtet."), { status: 409 });
      }
      const device = {
        id: id("kiosk"),
        name,
        locationId,
        active: true,
        locked: false,
        activationVersion: 1,
        createdAt: now(),
        createdBy: ctx.admin.id,
      };
      state.kioskDevices.push(device);
      kioskActivation = {
        eventType: "CREATE_KIOSK_DEVICE",
        deviceId: device.id,
        deviceName: device.name,
        locationId,
        code: activationCode(),
      };
      addAudit(state, ctx, "kiosk.created", "kiosk", device.id, device.name, { locationId });
      break;
    }
    case "ROTATE_KIOSK_ACTIVATION": {
      const device = state.kioskDevices.find((item: any) => item.id === event.id && item.active !== false);
      if (!device) throw Object.assign(new Error("Kiosk-Gerät wurde nicht gefunden."), { status: 404 });
      if (ctx.accessRole === "manager" && !allowedLocations(ctx).has(device.locationId)) {
        throw Object.assign(new Error("Kein Zugriff auf dieses Kiosk-Gerät."), { status: 403 });
      }
      const version = Number(device.activationVersion || 0) + 1;
      state.kioskDevices = state.kioskDevices.map((item: any) => item.id === device.id
        ? { ...item, locked: false, activationVersion: version, activatedAt: now(), activatedBy: ctx.admin.id }
        : item);
      kioskActivation = {
        eventType: "ROTATE_KIOSK_ACTIVATION",
        deviceId: device.id,
        deviceName: device.name || device.id,
        locationId: device.locationId,
        code: activationCode(),
      };
      addAudit(state, ctx, "kiosk.activation_rotated", "kiosk", device.id, device.name || device.id, { locationId: device.locationId });
      break;
    }
    case "TOGGLE_KIOSK_LOCK": {
      if (typeof event.locked !== "boolean") {
        throw Object.assign(new Error("Der gewünschte Sperrstatus fehlt."), { status: 400 });
      }
      const device = state.kioskDevices.find((item: any) => item.id === event.id);
      if (!device) throw Object.assign(new Error("Kiosk-Gerät wurde nicht gefunden."), { status: 404 });
      if (ctx.accessRole === "manager" && !allowedLocations(ctx).has(device.locationId)) {
        throw Object.assign(new Error("Kein Zugriff auf dieses Kiosk-Gerät."), { status: 403 });
      }
      state.kioskDevices = state.kioskDevices.map((item: any) => item.id === device.id
        ? {
          ...item,
          locked: event.locked,
          lockedAt: event.locked ? now() : null,
          lockedBy: event.locked ? ctx.admin.id : null,
          updatedAt: now(),
          updatedBy: ctx.admin.id,
        }
        : item);
      addAudit(
        state,
        ctx,
        event.locked ? "kiosk.locked" : "kiosk.unlocked",
        "kiosk",
        device.id,
        device.name || device.id,
        { locationId: device.locationId },
      );
      break;
    }
    default:
      throw Object.assign(new Error("Unbekannte Verwaltungsaktion."), { status: 400 });
  }

  const revision = kioskActivation
    ? await persistKioskActivation(ctx, state, kioskActivation)
    : await persist(ctx, state);
  if (revokeTokenId) await revokeInvitationToken(ctx, revokeTokenId);
  for (const task of postCommit) await task();
  const delivery = invitation && inviteRole ? await issueInvitationToken({ ...ctx, state }, invitation, inviteRole, origin) : null;
  const { data: finalSnapshot, error: finalError } = await service.from("workspace_snapshots")
    .select("state,revision").eq("organization_id", ctx.organization.id).single();
  if (finalError || !finalSnapshot) throw finalError || new Error("Finaler Snapshot fehlt.");
  const appOrigin = origin && allowedOrigin(origin) ? origin : DEFAULT_ORIGIN;
  const kioskUrl = kioskActivation
    ? `${appOrigin}/kiosk/dashboard/?workspace=${encodeURIComponent(ctx.organization.slug)}`
    : null;
  return {
    state: scopeState(ctx, normalize(finalSnapshot.state)),
    revision: finalSnapshot.revision || revision,
    delivery,
    kioskActivation: kioskActivation ? {
      deviceId: kioskActivation.deviceId,
      deviceName: kioskActivation.deviceName,
      activationCode: kioskActivation.code,
      kioskUrl,
    } : null,
  };
}

Deno.serve(async (request) => {
  const directOrigin = request.headers.get("origin");
  const trustedProxy = request.headers.get("authorization") === `Bearer ${SERVICE_KEY}`
    && request.headers.get("apikey") === SERVICE_KEY;
  const forwardedOrigin = trustedProxy ? request.headers.get("x-aora-request-origin") : null;
  const origin = directOrigin || (forwardedOrigin && allowedOrigin(forwardedOrigin) ? forwardedOrigin : null);
  if (request.method === "OPTIONS") return new Response("ok", { headers: cors(origin) });
  if (request.method !== "POST") return reply({ error: "Method not allowed" }, 405, origin);
  if (origin && !allowedOrigin(origin)) return reply({ error: "Origin not allowed" }, 403, origin);
  const contentLength = Number(request.headers.get("content-length") || 0);
  if (contentLength > MAX_BODY_BYTES) return reply({ error: "Request too large" }, 413, origin);

  try {
    const body = await request.json();
    const token = String(body.token || "");
    if (token.length !== 64) return reply({ error: "Sitzungstoken fehlt." }, 401, origin);
    const ctx = await context(token);
    const session = {
      organizationId: ctx.organization.id,
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

    if (body.action === "load") {
      if (ctx.accessRole === "owner" || ctx.accessRole === "manager") {
        return reply({ state: scopeState(ctx, ctx.state), revision: ctx.snapshot.revision, session }, 200, origin);
      }
      const data = await callLegacy({ action: "load", token });
      return reply({ ...data, session: { ...data.session, ...session } }, 200, origin);
    }
    if (body.action !== "apply") return reply({ error: "Unbekannte Aktion." }, 400, origin);

    if (STRUCTURAL_TYPES.has(body.event?.type)) {
      const data = await applyStructural(ctx, body.event, Number(body.expectedRevision), origin);
      return reply({ ...data, session }, 200, origin);
    }

    let securedEvent = mapKioskTransition(ctx, body.event);
    if (ctx.accessRole === "manager") securedEvent = guardManagerEvent(ctx, securedEvent);
    const data = await callLegacy({
      action: "apply", token, event: securedEvent, expectedRevision: body.expectedRevision,
    });
    return reply({
      ...data,
      state: scopeState(ctx, data.state),
      session: { ...data.session, ...session },
    }, 200, origin);
  } catch (error: any) {
    return reply({
      error: error instanceof Error ? error.message : String(error),
      ...(error?.data || {}),
    }, Number(error?.status || 500), origin);
  }
});

