import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";

const URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const WORKSPACE_SLUG = "aora-v8-final-demo";
const PASSWORD_ITERATIONS = 210_000;
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
const fromHex = (value: string) =>
  Uint8Array.from(value.match(/.{1,2}/g) || [], (part) => parseInt(part, 16));
const randomHex = (bytes = 32) => hex(crypto.getRandomValues(new Uint8Array(bytes)));

async function sha256(value: string) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return hex(new Uint8Array(digest));
}

async function derivePassword(
  password: string,
  salt: string,
  iterations = PASSWORD_ITERATIONS,
) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      salt: fromHex(salt),
      iterations,
    },
    key,
    256,
  );
  return hex(new Uint8Array(bits));
}

function constantTimeEqual(left: string, right: string) {
  if (left.length !== right.length) return false;
  let result = 0;
  for (let index = 0; index < left.length; index++) {
    result |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return result === 0;
}

function validPassword(password: string) {
  return password.length >= 10 &&
    password.length <= 128 &&
    /[a-z]/.test(password) &&
    /[A-Z]/.test(password) &&
    /\d/.test(password);
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
    String(item.email || "").toLowerCase() === normalized &&
    item.active !== false && item.status !== "revoked"
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
  const token = randomHex(32);
  const expiresAt = new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString();
  const { error } = await service.from("app_sessions").insert({
    organization_id: organizationId,
    role: record.role,
    subject_id: record.subjectId,
    location_id: record.locationId,
    token_hash: `\\x${await sha256(token)}`,
    expires_at: expiresAt,
  });
  if (error) throw error;
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

async function consumeAttempt(request: Request, email: string, accessRole: string) {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const client = forwarded || request.headers.get("cf-connecting-ip") || "unknown";
  const bucket = await sha256(`${client}:${accessRole}:${email}`);
  const now = new Date();
  const windowMs = 10 * 60 * 1000;
  const limit = 7;
  const { data: current, error: readError } = await service
    .from("aora_login_rate_limits")
    .select("bucket,window_started_at,attempts")
    .eq("bucket", bucket)
    .maybeSingle();
  if (readError) throw readError;
  const started = current?.window_started_at
    ? new Date(current.window_started_at)
    : now;
  const expired = now.getTime() - started.getTime() >= windowMs;
  const attempts = expired ? 0 : Number(current?.attempts || 0);
  if (attempts >= limit) return { allowed: false, bucket };
  const { error: writeError } = await service.from("aora_login_rate_limits").upsert({
    bucket,
    window_started_at: expired || !current ? now.toISOString() : started.toISOString(),
    attempts: attempts + 1,
    updated_at: now.toISOString(),
  });
  if (writeError) throw writeError;
  return { allowed: true, bucket };
}

async function inspectInvitation(workspace: any, invitationId: string, token: string) {
  const invitation = (workspace.state.invitations || []).find((item: any) =>
    item.id === invitationId && item.status === "pending"
  );
  if (!invitation || new Date(invitation.expiresAt) <= new Date()) return null;
  const { data: tokenRow, error } = await service
    .from("aora_v8_final_invitation_tokens")
    .select("token_hash,expires_at,used_at,revoked_at")
    .eq("organization_id", workspace.organization.id)
    .eq("invitation_id", invitationId)
    .maybeSingle();
  if (error || !tokenRow || tokenRow.used_at || tokenRow.revoked_at) return null;
  if (new Date(tokenRow.expires_at) <= new Date()) return null;
  const suppliedHash = await sha256(token);
  if (!constantTimeEqual(suppliedHash, String(tokenRow.token_hash).trim())) return null;
  return invitation;
}

async function acceptInvitation(workspace: any, body: any) {
  const invitationId = String(body.invitationId || "");
  const token = String(body.token || "");
  const email = String(body.email || "").trim().toLowerCase();
  const password = String(body.password || "");
  if (!validPassword(password)) {
    throw Object.assign(
      new Error("Das Passwort benötigt mindestens 10 Zeichen, Groß-/Kleinbuchstaben und eine Zahl."),
      { status: 400 },
    );
  }
  const invitation = await inspectInvitation(workspace, invitationId, token);
  if (!invitation || String(invitation.email || "").toLowerCase() !== email) {
    throw Object.assign(new Error("Einladung ist ungültig oder abgelaufen."), {
      status: 401,
    });
  }
  const record = accessRecord(workspace.state, email);
  if (!record || record.subjectId !== invitation.subjectId) {
    throw Object.assign(new Error("Eingeladenes Konto wurde nicht gefunden."), {
      status: 404,
    });
  }

  const salt = randomHex(16);
  const passwordHash = await derivePassword(password, salt);
  const { error: credentialError } = await service
    .from("aora_v8_final_credentials")
    .upsert({
      organization_id: workspace.organization.id,
      subject_role: record.role,
      subject_id: record.subjectId,
      email,
      salt,
      password_hash: passwordHash,
      iterations: PASSWORD_ITERATIONS,
      active: true,
      updated_at: new Date().toISOString(),
    }, { onConflict: "organization_id,subject_role,subject_id" });
  if (credentialError) throw credentialError;

  const acceptedAt = new Date().toISOString();
  const state = structuredClone(workspace.state);
  state.invitations = (state.invitations || []).map((item: any) =>
    item.id === invitationId
      ? { ...item, status: "accepted", acceptedAt, emailStatus: "delivered" }
      : item
  );
  if (record.kind === "admin") {
    state.admins = (state.admins || []).map((item: any) =>
      item.id === record.subjectId
        ? { ...item, active: true, status: "active", acceptedAt }
        : item
    );
  } else {
    state.employees = (state.employees || []).map((item: any) =>
      item.id === record.subjectId
        ? { ...item, active: true, status: "active", acceptedAt }
        : item
    );
  }

  const revision = Number(workspace.snapshot.revision) + 1;
  const { data: updated, error: snapshotError } = await service
    .from("workspace_snapshots")
    .update({ state, revision, updated_at: acceptedAt })
    .eq("organization_id", workspace.organization.id)
    .eq("revision", workspace.snapshot.revision)
    .select("revision")
    .maybeSingle();
  if (snapshotError || !updated) {
    await service.from("aora_v8_final_credentials")
      .delete()
      .eq("organization_id", workspace.organization.id)
      .eq("subject_role", record.role)
      .eq("subject_id", record.subjectId);
    throw Object.assign(new Error("Einladung wurde parallel geändert. Bitte neu öffnen."), {
      status: 409,
    });
  }
  const { error: projectionError } = await service.rpc("project_workspace_state", {
    p_organization_id: workspace.organization.id,
    p_state: state,
  });
  if (projectionError) throw projectionError;
  await service.from("aora_v8_final_invitation_tokens")
    .update({ used_at: acceptedAt, updated_at: acceptedAt })
    .eq("organization_id", workspace.organization.id)
    .eq("invitation_id", invitationId);
  return createSession(workspace.organization.id, record);
}

Deno.serve(async (request) => {
  const origin = request.headers.get("origin");
  if (request.method === "OPTIONS") return new Response("ok", { headers: cors(origin) });
  if (request.method !== "POST") return reply({ error: "Method not allowed" }, 405, origin);
  if (origin && !allowedOrigin(origin)) return reply({ error: "Origin not allowed" }, 403, origin);

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
          .filter((item: any) => item.active !== false && item.status !== "pending")
          .map((item: any) => ({
            id: item.id,
            name: item.name,
            role: item.role,
            locationId: item.locationId,
          })),
        admins: (state.admins || [])
          .filter((item: any) => item.active !== false && item.scope === "owner")
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
      if (!new Set(["owner", "kiosk"]).has(requestedRole)) {
        return reply({ error: "Bitte mit E-Mail und Passwort anmelden." }, 400, origin);
      }
      const dbRole = requestedRole === "owner" ? "admin" : "kiosk";
      const subjectId = String(body.subjectId || "");
      if (dbRole === "admin") {
        const admin = (workspace.state.admins || []).find((item: any) =>
          item.id === subjectId && item.active !== false && item.scope === "owner"
        );
        if (!admin) return reply({ error: "Ungültiger Zugang." }, 403, origin);
      }
      const { data, error } = await service.rpc("demo_login", {
        p_workspace_slug: WORKSPACE_SLUG,
        p_role: dbRole,
        p_subject_id: subjectId,
        p_pin: body.pin == null ? null : String(body.pin),
      });
      if (error) return reply({ error: error.message }, 401, origin);
      return reply({ ...data, accessRole: requestedRole }, 200, origin);
    }

    if (action === "passwordLogin") {
      const email = String(body.email || "").trim().toLowerCase();
      const password = String(body.password || "");
      const requestedAccessRole = String(body.accessRole || "");
      const rate = await consumeAttempt(request, email, requestedAccessRole);
      if (!rate.allowed) {
        return reply({ error: "Zu viele Anmeldeversuche. Bitte später erneut versuchen." }, 429, origin);
      }
      const record = accessRecord(workspace.state, email);
      const { data: credential } = await service
        .from("aora_v8_final_credentials")
        .select("salt,password_hash,iterations,active")
        .eq("organization_id", workspace.organization.id)
        .eq("email", email)
        .maybeSingle();
      let valid = false;
      if (
        record &&
        record.accessRole === requestedAccessRole &&
        record.record.status === "active" &&
        credential?.active
      ) {
        const supplied = await derivePassword(
          password,
          credential.salt,
          Number(credential.iterations),
        );
        valid = constantTimeEqual(supplied, credential.password_hash);
      } else {
        await derivePassword(password || "invalid-password", randomHex(16));
      }
      if (!valid || !record) {
        return reply({ error: "E-Mail oder Passwort ist nicht korrekt." }, 401, origin);
      }
      await service.from("aora_login_rate_limits").delete().eq("bucket", rate.bucket);
      return reply(await createSession(workspace.organization.id, record), 200, origin);
    }

    if (action === "inspectInvitation") {
      const invitationId = String(body.invitationId || "");
      const token = String(body.token || "");
      const invitation = await inspectInvitation(workspace, invitationId, token);
      if (!invitation) {
        return reply({ valid: false }, 200, origin);
      }
      const email = String(invitation.email || "");
      const [local, domain] = email.split("@");
      return reply({
        valid: true,
        invitationId,
        name: invitation.name,
        kind: invitation.kind,
        emailHint: `${local?.slice(0, 2) || ""}•••@${domain || ""}`,
        expiresAt: invitation.expiresAt,
      }, 200, origin);
    }

    if (action === "acceptInvitation") {
      return reply(await acceptInvitation(workspace, body), 200, origin);
    }

    if (action === "logout") {
      const token = String(body.token || "");
      if (token) await service.rpc("demo_logout", { p_token: token });
      return reply({ ok: true }, 200, origin);
    }

    return reply({ error: "Unknown action" }, 400, origin);
  } catch (error: any) {
    return reply({
      error: error instanceof Error ? error.message : String(error),
    }, Number(error?.status || 500), origin);
  }
});
