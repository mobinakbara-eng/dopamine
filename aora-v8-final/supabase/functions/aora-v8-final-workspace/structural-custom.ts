import {
  addAudit,
  allowedLocations,
  clone,
  emailOk,
  id,
  normalize,
  now,
  persist,
  scopeState,
  service,
} from "./core.ts";
import {
  prepareInvitationToken,
} from "./invitation.ts";
import { appOriginForRequest } from "./origin.ts";

export const STRUCTURAL_TYPES = new Set([
  "ADD_LOCATION",
  "UPDATE_LOCATION",
  "ARCHIVE_LOCATION",
  "INVITE_MANAGER",
  "CREATE_EMPLOYEE_ACCOUNT",
  "RESEND_INVITATION",
  "REVOKE_INVITATION",
  "UPDATE_MANAGER_ACCESS",
  "DEACTIVATE_ACCOUNT",
  "ADD_ANNOUNCEMENT",
  "CREATE_KIOSK_DEVICE",
  "ROTATE_KIOSK_ACTIVATION",
  "TOGGLE_KIOSK_LOCK",
]);

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
  return { latitude, longitude, gps: { lat: latitude, lng: longitude }, gpsConfigured: true };
}

function activationCode() {
  let value = "";
  while (value.length < 8) {
    for (const byte of crypto.getRandomValues(new Uint8Array(16))) {
      if (byte < 250) value += String(byte % 10);
      if (value.length === 8) break;
    }
  }
  return value;
}

async function persistKioskActivation(ctx: any, state: any, activation: any) {
  const changedAt = now();
  const revision = Number(ctx.snapshot.revision) + 1;
  state.meta = { ...(state.meta || {}), revision, updatedAt: changedAt, variant: "isolated-v8-final" };
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
      throw Object.assign(new Error("Daten wurden parallel geändert. Bitte neu laden."), { status: 409 });
    }
    throw error || new Error("Kiosk-Aktivierung konnte nicht gespeichert werden.");
  }
  return revision;
}

async function persistAccountDeactivation(ctx: any, state: any, account: any) {
  const revision = Number(ctx.snapshot.revision) + 1;
  state.meta = { ...(state.meta || {}), revision, updatedAt: now(), variant: "isolated-v8-final" };
  const { data, error } = await service.rpc("aora_commit_account_deactivation", {
    p_organization_id: ctx.organization.id,
    p_expected_revision: Number(ctx.snapshot.revision),
    p_state: state,
    p_actor_role: ctx.accessRole,
    p_actor_id: ctx.admin.id,
    p_subject_role: account.subjectRole,
    p_subject_id: account.subjectId,
    p_event_payload: account.eventPayload || {},
  });
  if (error || Number(data) !== revision) throw error || new Error("Konto konnte nicht atomar deaktiviert werden.");
  return revision;
}

async function persistInvitationChange(ctx: any, state: any, event: any, prepared: any, revokeTokenId: string | null) {
  const revision = Number(ctx.snapshot.revision) + 1;
  state.meta = { ...(state.meta || {}), revision, updatedAt: now(), variant: "isolated-v8-final" };
  const invitationId = prepared?.delivery?.invitationId || revokeTokenId;
  const { data, error } = await service.rpc("aora_commit_invitation_change", {
    p_organization_id: ctx.organization.id,
    p_expected_revision: Number(ctx.snapshot.revision),
    p_state: state,
    p_actor_role: ctx.accessRole,
    p_actor_id: ctx.admin.id,
    p_event_type: event.type,
    p_event_payload: event,
    p_invitation_id: invitationId,
    p_token_hash: prepared?.tokenHash || null,
    p_expires_at: prepared?.delivery?.expiresAt || null,
    p_revoke: Boolean(revokeTokenId),
  });
  if (error || Number(data) !== revision) throw error || new Error("Einladung konnte nicht atomar gespeichert werden.");
  return revision;
}

const requireOwner = (ctx: any, message: string) => {
  if (ctx.accessRole !== "owner") {
    throw Object.assign(new Error(message), { status: 403 });
  }
};

const requireLocation = (state: any, locationId: string) => {
  if (!state.locations.some((item: any) =>
    item.id === locationId && item.active !== false
  )) {
    throw Object.assign(new Error("Laden wurde nicht gefunden."), {
      status: 404,
    });
  }
};

const ensureEmailAvailable = (state: any, email: string) => {
  const used = [...state.admins, ...state.employees].some((item: any) =>
    String(item.email || "").toLowerCase() === email && item.status !== "revoked"
  );
  const pending = state.invitations.some((item: any) =>
    String(item.email || "").toLowerCase() === email && item.status === "pending"
  );
  if (used || pending) {
    throw Object.assign(
      new Error("Diese E-Mail-Adresse besitzt bereits einen Zugang oder eine offene Einladung."),
      { status: 409 },
    );
  }
};

const invitationLocations = (invitation: any) =>
  (invitation.locationIds || [invitation.locationId]).filter(Boolean);

const requireInvitationAccess = (ctx: any, invitation: any) => {
  if (ctx.accessRole !== "manager") return;
  const locations = allowedLocations(ctx);
  if (
    invitation.kind !== "employee" ||
    !invitationLocations(invitation).some((locationId: string) =>
      locations.has(locationId)
    )
  ) {
    throw Object.assign(new Error("Kein Zugriff auf diese Einladung."), {
      status: 403,
    });
  }
};

export async function applyStructural(
  ctx: any,
  event: any,
  expectedRevision: number,
  origin: string | null,
) {
  if (Number(expectedRevision) !== Number(ctx.snapshot.revision)) {
    throw Object.assign(
      new Error("Daten wurden auf einem anderen Gerät geändert."),
      { status: 409 },
    );
  }
  if (!new Set(["owner", "manager"]).has(ctx.accessRole)) {
    throw Object.assign(new Error("Verwaltungszugang erforderlich."), {
      status: 403,
    });
  }

  const state = clone(ctx.state);
  let invitation: any = null;
  let inviteRole: "manager" | "employee" | null = null;
  let revokeTokenId: string | null = null;
  let kioskActivation: any = null;
  let deactivation: any = null;

  switch (event.type) {
    case "ADD_LOCATION": {
      requireOwner(ctx, "Nur der Inhaber kann einen Laden anlegen.");
      const input = event.location || {};
      const name = String(input.name || "").trim();
      const city = String(input.city || "").trim();
      if (name.length < 2 || city.length < 2) {
        throw Object.assign(new Error("Name und Stadt sind erforderlich."), {
          status: 400,
        });
      }
      if (state.locations.some((item: any) =>
        item.active !== false &&
        String(item.name).toLowerCase() === name.toLowerCase() &&
        String(item.city).toLowerCase() === city.toLowerCase()
      )) {
        throw Object.assign(new Error("Dieser Laden existiert bereits."), {
          status: 409,
        });
      }
      const gps = locationGps(input);
      const location = {
        id: id("loc"),
        name,
        city,
        address: String(input.address || "").trim(),
        country: String(input.country || "Deutschland").trim(),
        timezone: String(
          input.timezone || state.company.timezone || "Europe/Berlin",
        ),
        costCenter: String(input.costCenter || "").trim(),
        geofenceRadius: Math.min(1000, Math.max(25, Number(input.geofenceRadius || 100))),
        ...gps,
        active: true,
        createdAt: now(),
        createdBy: ctx.admin.id,
      };
      state.locations.push(location);
      state.admins = state.admins.map((admin: any) =>
        admin.scope === "owner"
          ? {
            ...admin,
            locationIds: [...new Set([...(admin.locationIds || []), location.id])],
          }
          : admin
      );
      addAudit(
        state,
        ctx,
        "location.created",
        "location",
        location.id,
        `${location.name} · ${location.city}`,
        { locationId: location.id },
      );
      break;
    }

    case "UPDATE_LOCATION": {
      requireOwner(ctx, "Nur der Inhaber kann Ladendaten ändern.");
      const current = state.locations.find((item: any) => item.id === event.id);
      if (!current) {
        throw Object.assign(new Error("Laden wurde nicht gefunden."), {
          status: 404,
        });
      }
      const patch = event.patch || {};
      const gps = locationGps(patch, current);
      state.locations = state.locations.map((item: any) =>
        item.id === current.id
          ? {
            ...item,
            name: patch.name == null ? item.name : String(patch.name).trim(),
            city: patch.city == null ? item.city : String(patch.city).trim(),
            address: patch.address == null ? item.address : String(patch.address).trim(),
            country: patch.country == null ? item.country : String(patch.country).trim(),
            timezone: patch.timezone == null ? item.timezone : String(patch.timezone),
            costCenter: patch.costCenter == null ? item.costCenter : String(patch.costCenter).trim(),
            geofenceRadius: patch.geofenceRadius == null ? item.geofenceRadius : Math.min(1000, Math.max(25, Number(patch.geofenceRadius))),
            ...gps,
            id: item.id,
            active: item.active,
            updatedAt: now(),
            updatedBy: ctx.admin.id,
          }
          : item
      );
      addAudit(
        state,
        ctx,
        "location.updated",
        "location",
        current.id,
        current.name,
        { locationId: current.id },
      );
      break;
    }

    case "ARCHIVE_LOCATION": {
      requireOwner(ctx, "Nur der Inhaber kann einen Laden archivieren.");
      const current = state.locations.find((item: any) =>
        item.id === event.id && item.active !== false
      );
      if (!current) {
        throw Object.assign(new Error("Aktiver Laden wurde nicht gefunden."), {
          status: 404,
        });
      }
      if (state.employees.some((item: any) =>
        item.locationId === current.id && item.active !== false
      )) {
        throw Object.assign(
          new Error("Aktive Mitarbeiter müssen zuerst versetzt oder deaktiviert werden."),
          { status: 409 },
        );
      }
      state.locations = state.locations.map((item: any) =>
        item.id === current.id
          ? {
            ...item,
            active: false,
            archivedAt: now(),
            archivedBy: ctx.admin.id,
          }
          : item
      );
      state.admins = state.admins.map((admin: any) => ({
        ...admin,
        locationIds: (admin.locationIds || []).filter((locationId: string) =>
          locationId !== current.id
        ),
      }));
      addAudit(
        state,
        ctx,
        "location.archived",
        "location",
        current.id,
        current.name,
        { locationId: current.id },
      );
      break;
    }

    case "INVITE_MANAGER": {
      requireOwner(ctx, "Nur der Inhaber kann Manager einladen.");
      const input = event.manager || {};
      const name = String(input.name || "").trim();
      const email = String(input.email || "").trim().toLowerCase();
      const locationIds = [...new Set((input.locationIds || []).map(String))];
      if (name.length < 2 || !emailOk(email) || !locationIds.length) {
        throw Object.assign(
          new Error("Name, gültige E-Mail und mindestens ein Laden sind erforderlich."),
          { status: 400 },
        );
      }
      for (const locationId of locationIds) requireLocation(state, locationId);
      ensureEmailAvailable(state, email);
      const manager = {
        id: id("admin"),
        name,
        email,
        role: "Manager",
        scope: "manager",
        locationIds,
        active: true,
        status: "pending",
        initials: name.split(/\s+/).slice(0, 2).map((part: string) => part[0])
          .join("").toUpperCase(),
        createdAt: now(),
        invitedBy: ctx.admin.id,
      };
      invitation = {
        id: id("invite"),
        kind: "manager",
        subjectId: manager.id,
        name,
        email,
        locationIds,
        status: "pending",
        invitedBy: ctx.admin.id,
        createdAt: now(),
        expiresAt: new Date(Date.now() + 7 * 86400000).toISOString(),
        emailStatus: "prepared",
      };
      state.admins.push(manager);
      state.invitations.unshift(invitation);
      inviteRole = "manager";
      addAudit(
        state,
        ctx,
        "manager.invited",
        "admin",
        manager.id,
        `${name} · ${email}`,
        { locationIds },
      );
      break;
    }

    case "CREATE_EMPLOYEE_ACCOUNT": {
      const input = event.employee || {};
      const name = String(input.name || "").trim();
      const email = String(input.email || "").trim().toLowerCase();
      const locationId = String(input.locationId || "");
      if (name.length < 2 || !emailOk(email) || !locationId) {
        throw Object.assign(
          new Error("Name, gültige E-Mail und Laden sind erforderlich."),
          { status: 400 },
        );
      }
      requireLocation(state, locationId);
      if (
        ctx.accessRole === "manager" &&
        !allowedLocations(ctx).has(locationId)
      ) {
        throw Object.assign(
          new Error("Du darfst nur Mitarbeiter deiner eigenen Läden anlegen."),
          { status: 403 },
        );
      }
      ensureEmailAvailable(state, email);
      const employee = {
        id: id("emp"),
        name,
        email,
        role: String(input.role || "Mitarbeiter").trim(),
        locationId,
        allowedLocationIds: [locationId],
        weeklyTarget: Number(input.weeklyTarget || 40),
        vacationAllowance: Number(input.vacationAllowance || 27.5),
        vacationUsed: 0,
        hourlyCost: Number(input.hourlyCost || 0),
        skills: Array.isArray(input.skills) ? input.skills.map(String) : [],
        active: true,
        status: "pending",
        initials: name.split(/\s+/).slice(0, 2).map((part: string) => part[0])
          .join("").toUpperCase(),
        createdAt: now(),
        invitedBy: ctx.admin.id,
      };
      invitation = {
        id: id("invite"),
        kind: "employee",
        subjectId: employee.id,
        name,
        email,
        locationId,
        locationIds: [locationId],
        status: "pending",
        invitedBy: ctx.admin.id,
        createdAt: now(),
        expiresAt: new Date(Date.now() + 7 * 86400000).toISOString(),
        emailStatus: "prepared",
      };
      state.employees.push(employee);
      state.invitations.unshift(invitation);
      inviteRole = "employee";
      addAudit(
        state,
        ctx,
        "employee.invited",
        "employee",
        employee.id,
        `${name} · ${email}`,
        { locationId },
      );
      break;
    }

    case "RESEND_INVITATION": {
      const current = state.invitations.find((item: any) =>
        item.id === event.id && item.status === "pending"
      );
      if (!current) {
        throw Object.assign(new Error("Offene Einladung wurde nicht gefunden."), {
          status: 404,
        });
      }
      requireInvitationAccess(ctx, current);
      invitation = {
        ...current,
        expiresAt: new Date(Date.now() + 7 * 86400000).toISOString(),
        emailStatus: "prepared",
        resentAt: now(),
      };
      state.invitations = state.invitations.map((item: any) =>
        item.id === current.id ? invitation : item
      );
      inviteRole = current.kind === "manager" ? "manager" : "employee";
      addAudit(
        state,
        ctx,
        "invitation.prepared_again",
        "invitation",
        current.id,
        current.email,
      );
      break;
    }

    case "REVOKE_INVITATION": {
      const current = state.invitations.find((item: any) =>
        item.id === event.id && item.status === "pending"
      );
      if (!current) {
        throw Object.assign(new Error("Offene Einladung wurde nicht gefunden."), {
          status: 404,
        });
      }
      requireInvitationAccess(ctx, current);
      revokeTokenId = current.id;
      state.invitations = state.invitations.map((item: any) =>
        item.id === current.id
          ? {
            ...item,
            status: "revoked",
            revokedAt: now(),
            revokedBy: ctx.admin.id,
          }
          : item
      );
      if (current.kind === "manager") {
        state.admins = state.admins.map((item: any) =>
          item.id === current.subjectId
            ? { ...item, active: false, status: "revoked", revokedAt: now() }
            : item
        );
      } else {
        state.employees = state.employees.map((item: any) =>
          item.id === current.subjectId
            ? { ...item, active: false, status: "revoked", revokedAt: now() }
            : item
        );
      }
      addAudit(
        state,
        ctx,
        "invitation.revoked",
        "invitation",
        current.id,
        current.email,
      );
      break;
    }

    case "UPDATE_MANAGER_ACCESS": {
      requireOwner(ctx, "Nur der Inhaber kann Manager-Rechte ändern.");
      const manager = state.admins.find((item: any) =>
        item.id === event.id &&
        item.scope === "manager" &&
        item.status !== "revoked"
      );
      if (!manager) {
        throw Object.assign(new Error("Manager wurde nicht gefunden."), {
          status: 404,
        });
      }
      const locationIds = [...new Set((event.locationIds || []).map(String))];
      if (!locationIds.length) {
        throw Object.assign(
          new Error("Mindestens ein gültiger Laden ist erforderlich."),
          { status: 400 },
        );
      }
      for (const locationId of locationIds) requireLocation(state, locationId);
      state.admins = state.admins.map((item: any) =>
        item.id === manager.id
          ? {
            ...item,
            locationIds,
            updatedAt: now(),
            updatedBy: ctx.admin.id,
          }
          : item
      );
      addAudit(
        state,
        ctx,
        "manager.access_updated",
        "admin",
        manager.id,
        manager.name,
        { locationIds },
      );
      break;
    }

    case "DEACTIVATE_ACCOUNT": {
      const kind = String(event.kind || "");
      if (!new Set(["manager", "employee"]).has(kind)) {
        throw Object.assign(new Error("Kontotyp ist ungültig."), {
          status: 400,
        });
      }
      const subjectRole = kind === "manager" ? "admin" : "employee";
      const collection = kind === "manager" ? "admins" : "employees";
      const account = state[collection].find((item: any) => item.id === event.id);
      if (!account || (kind === "manager" && account.scope !== "manager")) {
        throw Object.assign(new Error("Konto wurde nicht gefunden."), {
          status: 404,
        });
      }
      if (kind === "manager") {
        requireOwner(ctx, "Nur der Inhaber kann Manager deaktivieren.");
      } else if (
        ctx.accessRole === "manager" &&
        !allowedLocations(ctx).has(account.locationId)
      ) {
        throw Object.assign(new Error("Kein Zugriff auf diesen Mitarbeiter."), {
          status: 403,
        });
      }
      state[collection] = state[collection].map((item: any) =>
        item.id === account.id
          ? {
            ...item,
            active: false,
            status: "revoked",
            revokedAt: now(),
            revokedBy: ctx.admin.id,
          }
          : item
      );
      deactivation = {
        subjectRole,
        subjectId: account.id,
        eventPayload: { kind, id: account.id, locationId: account.locationId || null },
      };
      addAudit(
        state,
        ctx,
        `${kind}.deactivated`,
        subjectRole,
        account.id,
        account.name,
        account.locationId ? { locationId: account.locationId } : null,
      );
      break;
    }

    case "ADD_ANNOUNCEMENT": {
      const input = event.announcement || {};
      const title = String(input.title || "").trim();
      const body = String(input.body || "").trim();
      const audience = String(input.audience || "").trim();
      if (!title || title.length > 160 || !body || body.length > 5000) {
        throw Object.assign(
          new Error("Titel und Text sind erforderlich und dürfen nicht zu lang sein."),
          { status: 400 },
        );
      }
      if (audience !== "all") requireLocation(state, audience);
      if (ctx.accessRole === "manager") {
        if (audience === "all" || !allowedLocations(ctx).has(audience)) {
          throw Object.assign(
            new Error("Manager dürfen Mitteilungen nur an ihre zugewiesenen Standorte senden."),
            { status: 403 },
          );
        }
      }
      const announcement = {
        id: id("announcement"),
        title,
        body,
        audience,
        createdAt: now(),
        createdBy: ctx.admin.id,
      };
      state.announcements = [announcement, ...(state.announcements || [])];
      addAudit(
        state,
        ctx,
        "announcement.created",
        "announcement",
        announcement.id,
        title,
        audience === "all" ? null : { locationId: audience },
      );
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
      if (state.kioskDevices.filter((item: any) =>
        item.locationId === locationId && item.active !== false
      ).length >= 10) {
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
      const device = state.kioskDevices.find((item: any) =>
        item.id === event.id && item.active !== false
      );
      if (!device) throw Object.assign(new Error("Kiosk-Gerät wurde nicht gefunden."), { status: 404 });
      if (ctx.accessRole === "manager" && !allowedLocations(ctx).has(device.locationId)) {
        throw Object.assign(new Error("Kein Zugriff auf dieses Kiosk-Gerät."), { status: 403 });
      }
      const version = Number(device.activationVersion || 0) + 1;
      state.kioskDevices = state.kioskDevices.map((item: any) =>
        item.id === device.id
          ? { ...item, locked: false, activationVersion: version, activatedAt: now(), activatedBy: ctx.admin.id }
          : item
      );
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
      state.kioskDevices = state.kioskDevices.map((item: any) =>
        item.id === device.id
          ? {
            ...item,
            locked: event.locked,
            lockedAt: event.locked ? now() : null,
            lockedBy: event.locked ? ctx.admin.id : null,
            updatedAt: now(),
            updatedBy: ctx.admin.id,
          }
          : item
      );
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
      throw Object.assign(new Error("Unbekannte Verwaltungsaktion."), {
        status: 400,
      });
  }

  const preparedInvitation = invitation && inviteRole
    ? await prepareInvitationToken({ ...ctx, state }, invitation, inviteRole, origin)
    : null;
  const revision = kioskActivation
    ? await persistKioskActivation(ctx, state, kioskActivation)
    : deactivation
    ? await persistAccountDeactivation(ctx, state, deactivation)
    : preparedInvitation || revokeTokenId
    ? await persistInvitationChange(ctx, state, event, preparedInvitation, revokeTokenId)
    : await persist(ctx, state, event.type, event);
  const delivery = preparedInvitation?.delivery || null;

  const { data: finalSnapshot, error: finalError } = await service
    .from("workspace_snapshots")
    .select("state,revision")
    .eq("organization_id", ctx.organization.id)
    .single();
  if (finalError || !finalSnapshot) {
    throw finalError || new Error("Finaler Snapshot fehlt.");
  }
  return {
    state: scopeState(ctx, normalize(finalSnapshot.state)),
    revision: finalSnapshot.revision || revision,
    delivery,
    kioskActivation: kioskActivation
      ? {
        deviceId: kioskActivation.deviceId,
        deviceName: kioskActivation.deviceName,
        activationCode: kioskActivation.code,
        kioskUrl: `${appOriginForRequest(origin)}/kiosk/dashboard/?workspace=${encodeURIComponent(ctx.organization.slug)}`,
      }
      : null,
  };
}
