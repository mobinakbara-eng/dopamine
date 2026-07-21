import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";

const URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const WORKSPACE_SLUG = "aora-v8-final-demo";
const service = createClient(URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const allowedOrigin = (origin: string | null) => {
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

const cors = (origin: string | null) => ({
  "Access-Control-Allow-Origin": origin && allowedOrigin(origin)
    ? origin
    : "https://aora-workforce.vercel.app",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Vary": "Origin",
});

const reply = (body: unknown, status = 200, origin: string | null = null) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      ...cors(origin),
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });

const hex = (bytes: Uint8Array) =>
  Array.from(bytes).map((byte) => byte.toString(16).padStart(2, "0")).join("");

async function sha256(value: string) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return hex(new Uint8Array(digest));
}

async function loadWorkspace() {
  const { data: organization, error: organizationError } = await service
    .from("organizations")
    .select("id,slug,status")
    .eq("slug", WORKSPACE_SLUG)
    .eq("status", "active")
    .single();
  if (organizationError || !organization) {
    throw new Error("Der isolierte Aora-V8-Arbeitsbereich wurde nicht gefunden.");
  }

  const { data: snapshot, error: snapshotError } = await service
    .from("workspace_snapshots")
    .select("state,revision")
    .eq("organization_id", organization.id)
    .single();
  if (snapshotError || !snapshot) {
    throw new Error("Arbeitsbereich konnte nicht geladen werden.");
  }
  return { organization, snapshot, state: snapshot.state || {} };
}

function accessRecord(state: any, email: string) {
  const normalized = email.trim().toLowerCase();
  const admin = (state.admins || []).find((item: any) =>
    String(item.email || "").toLowerCase() === normalized && item.status !== "revoked"
  );
  if (admin) {
    return {
      kind: "admin",
      record: admin,
      role: "admin",
      accessRole: admin.scope === "owner" ? "owner" : "manager",
      subjectId: admin.id,
      locationId: admin.locationIds?.[0] || admin.locationId || null,
    };
  }

  const employee = (state.employees || []).find((item: any) =>
    String(item.email || "").toLowerCase() === normalized &&
    item.active !== false && item.status !== "revoked"
  );
  if (employee) {
    return {
      kind: "employee",
      record: employee,
      role: "employee",
      accessRole: "employee",
      subjectId: employee.id,
      locationId: employee.locationId || null,
    };
  }
  return null;
}

async function createSession(organizationId: string, record: any) {
  const token = hex(crypto.getRandomValues(new Uint8Array(32)));
  const tokenHash = await sha256(token);
  const expiresAt = new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString();

  const identity = {
    organization_id: organizationId,
    role: record.role,
    subject_id: record.subjectId,
    display_name: record.record.name || record.record.displayName || record.subjectId,
    location_id: record.locationId,
    pin_hash: null,
    active: true,
  };
  const { error: identityError } = await service
    .from("demo_identities")
    .upsert(identity, { onConflict: "organization_id,role,subject_id" });
  if (identityError) throw identityError;

  const { error: sessionError } = await service.from("app_sessions").insert({
    organization_id: organizationId,
    role: record.role,
    subject_id: record.subjectId,
    location_id: record.locationId,
    token_hash: `\\x${tokenHash}`,
    expires_at: expiresAt,
  });
  if (sessionError) throw sessionError;

  return {
    token,
    organizationId,
    role: record.role,
    accessRole: record.accessRole,
    subjectId: record.subjectId,
    employeeId: record.role === "employee" ? record.subjectId : null,
    adminId: record.role === "admin" ? record.subjectId : null,
    locationId: record.locationId,
    expiresAt,
  };
}

async function persistAcceptedInvitation(
  workspace: any,
  invitationId: string | null,
  record: any,
  userId: string,
) {
  const state = structuredClone(workspace.state);
  const acceptedAt = new Date().toISOString();
  state.invitations = (state.invitations || []).map((item: any) => {
    const same = invitationId
      ? item.id === invitationId
      : String(item.email || "").toLowerCase() ===
          String(record.record.email || "").toLowerCase() && item.status === "pending";
    return same ? { ...item, status: "accepted", acceptedAt, authUserId: userId } : item;
  });

  if (record.kind === "admin") {
    state.admins = (state.admins || []).map((item: any) =>
      item.id === record.subjectId
        ? { ...item, active: true, status: "active", acceptedAt, authUserId: userId }
        : item
    );
  } else {
    state.employees = (state.employees || []).map((item: any) =>
      item.id === record.subjectId
        ? { ...item, active: true, status: "active", acceptedAt, authUserId: userId }
        : item
    );
  }

  const nextRevision = Number(workspace.snapshot.revision) + 1;
  const { data: updated, error: updateError } = await service
    .from("workspace_snapshots")
    .update({ state, revision: nextRevision, updated_at: acceptedAt })
    .eq("organization_id", workspace.organization.id)
    .eq("revision", workspace.snapshot.revision)
    .select("revision")
    .maybeSingle();
  if (updateError || !updated) {
    throw new Error("Einladung wurde parallel geändert. Bitte erneut öffnen.");
  }
  const { error: projectionError } = await service.rpc("project_workspace_state", {
    p_organization_id: workspace.organization.id,
    p_state: state,
  });
  if (projectionError) throw projectionError;
}

Deno.serve(async (request) => {
  const origin = request.headers.get("origin");
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: cors(origin) });
  }
  if (request.method !== "POST") {
    return reply({ error: "Method not allowed" }, 405, origin);
  }
  if (origin && !allowedOrigin(origin)) {
    return reply({ error: "Origin not allowed" }, 403, origin);
  }

  try {
    const body = await request.json();
    const action = String(body.action || "");
    const workspace = await loadWorkspace();

    if (action === "directory") {
      const state = workspace.state;
      return reply({
        company: state.company,
        locations: state.locations || [],
        employees: (state.employees || [])
          .filter((item: any) => item.active !== false)
          .map((item: any) => ({
            id: item.id,
            name: item.name,
            role: item.role,
            locationId: item.locationId,
          })),
        admins: (state.admins || [])
          .filter((item: any) => item.active !== false)
          .map((item: any) => ({
            id: item.id,
            name: item.name,
            role: item.role,
            scope: item.scope || "owner",
            locationIds: item.locationIds || [],
          })),
        kioskDevices: state.kioskDevices || [],
        repositoryMode: "isolated-v8-final",
      }, 200, origin);
    }

    if (action === "login") {
      const requestedRole = String(body.role || "");
      const dbRole = ["owner", "manager", "admin"].includes(requestedRole)
        ? "admin"
        : requestedRole;
      if (!["admin", "employee", "kiosk"].includes(dbRole)) {
        return reply({ error: "Ungültiger Arbeitsbereich." }, 400, origin);
      }
      const subjectId = String(body.subjectId || "");
      if (dbRole === "admin") {
        const admin = (workspace.state.admins || []).find((item: any) =>
          item.id === subjectId && item.active !== false
        );
        const expected = requestedRole === "owner" ? "owner" : "manager";
        if (!admin || (admin.scope || "owner") !== expected) {
          return reply({ error: "Dieser Zugang gehört zu einem anderen Arbeitsbereich." }, 403, origin);
        }
      }
      const { data, error } = await service.rpc("demo_login", {
        p_workspace_slug: WORKSPACE_SLUG,
        p_role: dbRole,
        p_subject_id: subjectId,
        p_pin: body.pin == null ? null : String(body.pin),
      });
      if (error) return reply({ error: error.message }, 401, origin);
      const accessRole = dbRole === "admin"
        ? ((workspace.state.admins || []).find((item: any) => item.id === subjectId)?.scope === "owner"
          ? "owner"
          : "manager")
        : dbRole;
      return reply({ ...data, accessRole }, 200, origin);
    }

    if (action === "sendMagicLink") {
      const email = String(body.email || "").trim().toLowerCase();
      const record = accessRecord(workspace.state, email);
      if (!record) return reply({ ok: true }, 200, origin);
      const redirectOrigin = origin && allowedOrigin(origin)
        ? origin
        : "https://aora-workforce.vercel.app";
      const route = record.accessRole === "employee"
        ? "arbeitnehmer/"
        : record.accessRole === "owner"
        ? "inhaber/"
        : "arbeitgeber/";
      const redirectTo = `${redirectOrigin}/${route}?email_login=1`;
      const { error } = await service.auth.signInWithOtp({
        email,
        options: { emailRedirectTo: redirectTo, shouldCreateUser: true },
      });
      if (error) throw error;
      return reply({
        ok: true,
        message: "Falls ein Aora-Konto existiert, wurde ein Anmeldelink versendet.",
      }, 200, origin);
    }

    if (action === "exchange") {
      const accessToken = String(body.accessToken || "");
      if (!accessToken) return reply({ error: "E-Mail-Sitzung fehlt." }, 400, origin);
      const { data: userData, error: userError } = await service.auth.getUser(accessToken);
      if (userError || !userData.user?.email) {
        return reply({ error: "Der E-Mail-Link ist ungültig oder abgelaufen." }, 401, origin);
      }
      const record = accessRecord(workspace.state, userData.user.email);
      if (!record) {
        return reply({ error: "Für diese E-Mail-Adresse besteht kein Aora-Zugang." }, 403, origin);
      }
      await persistAcceptedInvitation(
        workspace,
        body.invitationId ? String(body.invitationId) : null,
        record,
        userData.user.id,
      );
      return reply(await createSession(workspace.organization.id, record), 200, origin);
    }

    if (action === "logout") {
      const token = String(body.token || "");
      if (token) await service.rpc("demo_logout", { p_token: token });
      return reply({ ok: true }, 200, origin);
    }

    return reply({ error: "Unknown action" }, 400, origin);
  } catch (error) {
    return reply({
      error: error instanceof Error ? error.message : String(error),
    }, 500, origin);
  }
});
