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
  sendInvite,
  service,
} from "./core.ts";

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
]);

const requireOwner = (ctx: any, message: string) => {
  if (ctx.accessRole !== "owner") {
    throw Object.assign(new Error(message), { status: 403 });
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
      const duplicate = state.locations.some((item: any) =>
        item.active !== false &&
        String(item.name).toLowerCase() === name.toLowerCase() &&
        String(item.city).toLowerCase() === city.toLowerCase()
      );
      if (duplicate) {
        throw Object.assign(new Error("Dieser Laden existiert bereits."), {
          status: 409,
        });
      }

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
        geofenceRadius: Number(input.geofenceRadius || 100),
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
      state.locations = state.locations.map((item: any) =>
        item.id === current.id
          ? {
            ...item,
            ...patch,
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
      if (
        state.employees.some((item: any) =>
          item.locationId === current.id && item.active !== false
        )
      ) {
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
      if (
        locationIds.some((locationId: string) =>
          !state.locations.some((item: any) =>
            item.id === locationId && item.active !== false
          )
        )
      ) {
        throw Object.assign(new Error("Mindestens ein Laden ist ungültig."), {
          status: 400,
        });
      }
      if (
        [...state.admins, ...state.employees].some((item: any) =>
          String(item.email || "").toLowerCase() === email &&
          item.status !== "revoked"
        )
      ) {
        throw Object.assign(
          new Error("Diese E-Mail-Adresse besitzt bereits einen Zugang."),
          { status: 409 },
        );
      }
      if (
        state.invitations.some((item: any) =>
          item.email === email && item.status === "pending"
        )
      ) {
        throw Object.assign(
          new Error("Für diese E-Mail-Adresse ist bereits eine Einladung offen."),
          { status: 409 },
        );
      }

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
        emailStatus: "pending",
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
      if (
        !state.locations.some((item: any) =>
          item.id === locationId && item.active !== false
        )
      ) {
        throw Object.assign(new Error("Laden wurde nicht gefunden."), {
          status: 404,
        });
      }
      if (
        ctx.accessRole === "manager" &&
        !allowedLocations(ctx).has(locationId)
      ) {
        throw Object.assign(
          new Error("Du darfst nur Mitarbeiter deiner eigenen Läden anlegen."),
          { status: 403 },
        );
      }
      if (
        [...state.admins, ...state.employees].some((item: any) =>
          String(item.email || "").toLowerCase() === email &&
          item.status !== "revoked"
        )
      ) {
        throw Object.assign(
          new Error("Diese E-Mail-Adresse besitzt bereits einen Zugang."),
          { status: 409 },
        );
      }
      if (
        state.invitations.some((item: any) =>
          item.email === email && item.status === "pending"
        )
      ) {
        throw Object.assign(
          new Error("Für diese E-Mail-Adresse ist bereits eine Einladung offen."),
          { status: 409 },
        );
      }

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
        emailStatus: "pending",
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
        emailStatus: "pending",
        resentAt: now(),
      };
      state.invitations = state.invitations.map((item: any) =>
        item.id === current.id ? invitation : item
      );
      inviteRole = current.kind === "manager" ? "manager" : "employee";
      addAudit(
        state,
        ctx,
        "invitation.resent",
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
      if (
        !locationIds.length ||
        locationIds.some((locationId: string) =>
          !state.locations.some((item: any) =>
            item.id === locationId && item.active !== false
          )
        )
      ) {
        throw Object.assign(
          new Error("Mindestens ein gültiger Laden ist erforderlich."),
          { status: 400 },
        );
      }
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

      if (kind === "manager") {
        requireOwner(ctx, "Nur der Inhaber kann Manager deaktivieren.");
        const manager = state.admins.find((item: any) =>
          item.id === event.id && item.scope === "manager"
        );
        if (!manager) {
          throw Object.assign(new Error("Manager wurde nicht gefunden."), {
            status: 404,
          });
        }
        state.admins = state.admins.map((item: any) =>
          item.id === manager.id
            ? {
              ...item,
              active: false,
              status: "revoked",
              revokedAt: now(),
              revokedBy: ctx.admin.id,
            }
            : item
        );
        await service.from("app_sessions")
          .update({ revoked_at: now() })
          .eq("organization_id", ctx.organization.id)
          .eq("role", "admin")
          .eq("subject_id", manager.id);
        addAudit(
          state,
          ctx,
          "manager.deactivated",
          "admin",
          manager.id,
          manager.name,
        );
      } else {
        const employee = state.employees.find((item: any) => item.id === event.id);
        if (!employee) {
          throw Object.assign(new Error("Mitarbeiter wurde nicht gefunden."), {
            status: 404,
          });
        }
        if (
          ctx.accessRole === "manager" &&
          !allowedLocations(ctx).has(employee.locationId)
        ) {
          throw Object.assign(new Error("Kein Zugriff auf diesen Mitarbeiter."), {
            status: 403,
          });
        }
        state.employees = state.employees.map((item: any) =>
          item.id === employee.id
            ? {
              ...item,
              active: false,
              status: "revoked",
              revokedAt: now(),
              revokedBy: ctx.admin.id,
            }
            : item
        );
        await service.from("app_sessions")
          .update({ revoked_at: now() })
          .eq("organization_id", ctx.organization.id)
          .eq("role", "employee")
          .eq("subject_id", employee.id);
        addAudit(
          state,
          ctx,
          "employee.deactivated",
          "employee",
          employee.id,
          employee.name,
          { locationId: employee.locationId },
        );
      }
      break;
    }

    default:
      throw Object.assign(new Error("Unbekannte Verwaltungsaktion."), {
        status: 400,
      });
  }

  let revision = await persist(ctx, state);
  let emailResult: any = null;

  if (invitation && inviteRole) {
    emailResult = await sendInvite(origin, invitation, inviteRole);
    const { data: fresh, error: freshError } = await service
      .from("workspace_snapshots")
      .select("state,revision")
      .eq("organization_id", ctx.organization.id)
      .single();
    if (freshError || !fresh) throw freshError || new Error("Snapshot fehlt.");

    const freshState = normalize(fresh.state);
    freshState.invitations = freshState.invitations.map((item: any) =>
      item.id === invitation.id
        ? {
          ...item,
          emailStatus: emailResult.sent ? "sent" : "failed",
          emailSentAt: emailResult.sent ? now() : null,
          emailError: emailResult.error,
        }
        : item
    );
    const freshCtx = { ...ctx, snapshot: fresh, state: freshState };
    revision = await persist(freshCtx, freshState);
  }

  const { data: finalSnapshot, error: finalError } = await service
    .from("workspace_snapshots")
    .select("state,revision")
    .eq("organization_id", ctx.organization.id)
    .single();
  if (finalError || !finalSnapshot) {
    throw finalError || new Error("Finaler Snapshot fehlt.");
  }
  const finalState = normalize(finalSnapshot.state);
  return {
    state: scopeState(ctx, finalState),
    revision: finalSnapshot.revision || revision,
    email: emailResult,
  };
}
