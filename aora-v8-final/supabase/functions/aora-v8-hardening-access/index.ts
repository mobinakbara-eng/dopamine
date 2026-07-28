import "jsr:@supabase/functions-js/edge-runtime.d.ts";
// @ts-ignore remote Deno import
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";

const URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const WORKSPACE_SLUG = "aora-v8-hardening-demo";
const PASSWORD_ITERATIONS = 210_000;
const MAX_BODY_BYTES = 32_768;
const DEFAULT_ORIGIN = "https://aora-v8-hardening.vercel.app";
const EXACT_ORIGINS = new Set([
  "https://aora-v8-hardening.vercel.app",
  "https://aora-v8-final.vercel.app",
  "https://aora-workforce.vercel.app",
]);
const TEAM_PREVIEW_SUFFIX = "-mobins-projects-4f428afa.vercel.app";

const service = createClient(URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

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

const hex = (bytes: Uint8Array) =>
  Array.from(bytes).map((byte) => byte.toString(16).padStart(2, "0")).join("");
const fromHex = (value: string) =>
  Uint8Array.from(value.match(/.{1,2}/g) || [], (part) => Number.parseInt(part, 16));
const randomHex = (bytes = 32) => hex(crypto.getRandomValues(new Uint8Array(bytes)));

async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return hex(new Uint8Array(digest));
}

async function derivePassword(password: string, salt: string, iterations = PASSWORD_ITERATIONS) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: fromHex(salt), iterations },
    key,
    256,
  );
  return hex(new Uint8Array(bits));
}

function constantTimeEqual(left: string, right: string) {
  const a = String(left || "").trim().toLowerCase();
  const b = String(right || "").trim().toLowerCase();
  if (a.length !== b.length) return false;
  let result = 0;
  for (let index = 0; index < a.length; index++) result |= a.charCodeAt(index) ^ b.charCodeAt(index);
  return result === 0;
}

function validPassword(password: string) {
  return password.length >= 10 &&
    password.length <= 128 &&
    /[a-z]/.test(password) &&
    /[A-Z]/.test(password) &&
    /\d/.test(password);
}

function clientAddress(request: Request) {
  return request.headers.get("cf-connecting-ip")?.trim() ||
    request.headers.get("x-real-ip")?.trim() ||
    request.headers.get("x-forwarded-for")?.split(",").at(-1)?.trim() ||
    "unknown";
}

async function consumeAttempt(
  request: Request,
  action: string,
  identifier: string,
  limit = 7,
  windowSeconds = 600,
) {
  const bucket = await sha256(`${WORKSPACE_SLUG}:${clientAddress(request)}:${action}:${identifier}`);
  const { data, error } = await service.rpc("aora_consume_rate_limit", {
    p_bucket: bucket,
    p_window_seconds: windowSeconds,
    p_limit: limit,
  }).maybeSingle();
  if (error || !data) throw error || new Error("Rate limit unavailable");
  return {
    allowed: Boolean(data.allowed),
    bucket,
    retryAfter: Number(data.retry_after_seconds || 0),
  };
}

async function clearAttempt(bucket: string) {
  await service.from("aora_login_rate_limits").delete().eq("bucket", bucket);
}

async function loadWorkspace() {
  const { data: organization, error: organizationError } = await service
    .from("organizations")
    .select("id,slug,status")
    .eq("slug", WORKSPACE_SLUG)
    .eq("status", "active")
    .single();
  if (organizationError || !organization) throw new Error("Der isolierte Aora-Arbeitsbereich wurde nicht gefunden.");

  const { data: snapshot, error: snapshotError } = await service
    .from("workspace_snapshots")
    .select("state,revision")
    .eq("organization_id", organization.id)
    .single();
  if (snapshotError || !snapshot) throw new Error("Arbeitsbereich konnte nicht geladen werden.");
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

async function inspectInvitation(workspace: any, invitationId: string, token: string) {
  if (!invitationId || token.length !== 64) return null;
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
  if (error || !tokenRow || tokenRow.used_at || tokenRow.revoked_at || new Date(tokenRow.expires_at) <= new Date()) {
    return null;
  }
  const suppliedHash = await sha256(token);
  if (!constantTimeEqual(suppliedHash, String(tokenRow.token_hash))) return null;
  return invitation;
}

async function acceptInvitation(workspace: any, body: any) {
  const invitationId = String(body.invitationId || "");
  const token = String(body.token || "");
  const email = String(body.email || "").trim().toLowerCase();
  const password = String(body.password || "");
  if (!validPassword(password)) {
    throw Object.assign(new Error("Das Passwort benötigt mindestens 10 Zeichen, Groß-/Kleinbuchstaben und eine Zahl."), { status: 400 });
  }

  const invitation = await inspectInvitation(workspace, invitationId, token);
  if (!invitation || String(invitation.email || "").toLowerCase() !== email) {
    throw Object.assign(new Error("Einladung ist ungültig oder abgelaufen."), { status: 401 });
  }
  const record = accessRecord(workspace.state, email);
  if (!record || record.subjectId !== invitation.subjectId || record.record.status !== "pending") {
    throw Object.assign(new Error("Eingeladenes Konto wurde nicht gefunden."), { status: 404 });
  }

  const salt = randomHex(16);
  const passwordHash = await derivePassword(password, salt);
  const acceptedAt = new Date().toISOString();
  const state = structuredClone(workspace.state);
  state.invitations = (state.invitations || []).map((item: any) =>
    item.id === invitationId
      ? { ...item, status: "accepted", acceptedAt, emailStatus: "delivered" }
      : item
  );
  if (record.kind === "admin") {
    state.admins = (state.admins || []).map((item: any) =>
      item.id === record.subjectId ? { ...item, active: true, status: "active", acceptedAt } : item
    );
  } else {
    state.employees = (state.employees || []).map((item: any) =>
      item.id === record.subjectId ? { ...item, active: true, status: "active", acceptedAt } : item
    );
  }

  const { error } = await service.rpc("aora_accept_invitation_atomic", {
    p_organization_id: workspace.organization.id,
    p_expected_revision: Number(workspace.snapshot.revision),
    p_invitation_id: invitationId,
    p_token_hash: await sha256(token),
    p_subject_role: record.role,
    p_subject_id: record.subjectId,
    p_email: email,
    p_salt: salt,
    p_password_hash: passwordHash,
    p_iterations: PASSWORD_ITERATIONS,
    p_state: state,
  });
  if (error) {
    const message = String(error.message || "");
    if (message.includes("revision_conflict")) {
      throw Object.assign(new Error("Einladung wurde parallel geändert. Bitte neu öffnen."), { status: 409 });
    }
    if (message.includes("invitation_invalid")) {
      throw Object.assign(new Error("Einladung ist ungültig oder abgelaufen."), { status: 401 });
    }
    throw error;
  }
  return createSession(workspace.organization.id, record);
}

Deno.serve(async (request) => {
  const origin = request.headers.get("origin");
  if (request.method === "OPTIONS") return new Response("ok", { headers: cors(origin) });
  if (request.method !== "POST") return reply({ error: "Method not allowed" }, 405, origin);
  if (origin && !allowedOrigin(origin)) return reply({ error: "Origin not allowed" }, 403, origin);

  const contentLength = Number(request.headers.get("content-length") || 0);
  if (contentLength > MAX_BODY_BYTES) return reply({ error: "Request too large" }, 413, origin);

  try {
    const body = await request.json();
    const action = String(body.action || "");
    const workspace = await loadWorkspace();

    if (action === "directory") {
      const rate = await consumeAttempt(request, "directory", "public", 30, 600);
      if (!rate.allowed) {
        return reply({ error: "Zu viele Anfragen. Bitte später erneut versuchen.", retryAfter: rate.retryAfter }, 429, origin);
      }
      const state = workspace.state;
      return reply({
        admins: (state.admins || [])
          .filter((item: any) => item.active !== false && item.scope === "owner")
          .map((item: any) => ({ id: item.id, name: item.name, scope: "owner" })),
        kioskDevices: (state.kioskDevices || [])
          .filter((item: any) => item.active !== false)
          .map((item: any) => ({ id: item.id, name: item.name || item.label || "Kiosk" })),
        repositoryMode: "isolated-v8-hardening",
      }, 200, origin);
    }

    if (action === "login") {
      const requestedRole = String(body.role || "");
      const subjectId = String(body.subjectId || "");
      if (!new Set(["owner", "kiosk"]).has(requestedRole) || !subjectId || subjectId.length > 100) {
        return reply({ error: "Ungültiger Zugang." }, 400, origin);
      }
      const rate = await consumeAttempt(request, "pin", `${requestedRole}:${subjectId}`);
      if (!rate.allowed) {
        return reply({ error: "Zu viele Anmeldeversuche. Bitte später erneut versuchen.", retryAfter: rate.retryAfter }, 429, origin);
      }

      const dbRole = requestedRole === "owner" ? "admin" : "kiosk";
      if (dbRole === "admin") {
        const admin = (workspace.state.admins || []).find((item: any) =>
          item.id === subjectId && item.active !== false && item.scope === "owner"
        );
        if (!admin) return reply({ error: "Ungültiger Zugang." }, 403, origin);
      } else {
        const device = (workspace.state.kioskDevices || []).find((item: any) => item.id === subjectId && item.active !== false);
        if (!device) return reply({ error: "Ungültiger Zugang." }, 403, origin);
      }

      const { data, error } = await service.rpc("demo_login", {
        p_workspace_slug: WORKSPACE_SLUG,
        p_role: dbRole,
        p_subject_id: subjectId,
        p_pin: body.pin == null ? null : String(body.pin),
      });
      if (error || !data) return reply({ error: "PIN oder Aktivierungscode ist nicht korrekt." }, 401, origin);
      await clearAttempt(rate.bucket);
      return reply({ ...data, accessRole: requestedRole }, 200, origin);
    }

    if (action === "passwordLogin") {
      const email = String(body.email || "").trim().toLowerCase();
      const password = String(body.password || "");
      const requestedAccessRole = String(body.accessRole || "");
      if (!new Set(["owner", "manager", "employee"]).has(requestedAccessRole) || email.length > 254 || password.length > 128) {
        return reply({ error: "E-Mail oder Passwort ist nicht korrekt." }, 401, origin);
      }
      const rate = await consumeAttempt(request, "password", `${requestedAccessRole}:${email}`);
      if (!rate.allowed) {
        return reply({ error: "Zu viele Anmeldeversuche. Bitte später erneut versuchen.", retryAfter: rate.retryAfter }, 429, origin);
      }

      const record = accessRecord(workspace.state, email);
      const { data: credential } = await service
        .from("aora_v8_final_credentials")
        .select("subject_role,subject_id,salt,password_hash,iterations,active")
        .eq("organization_id", workspace.organization.id)
        .eq("email", email)
        .maybeSingle();

      let valid = false;
      if (
        record && record.accessRole === requestedAccessRole && record.record.status === "active" && credential?.active &&
        credential.subject_role === record.role && credential.subject_id === record.subjectId
      ) {
        const supplied = await derivePassword(password, credential.salt, Number(credential.iterations));
        valid = constantTimeEqual(supplied, credential.password_hash);
      } else {
        await derivePassword(password || "invalid-password", randomHex(16));
      }
      if (!valid || !record) return reply({ error: "E-Mail oder Passwort ist nicht korrekt." }, 401, origin);
      await clearAttempt(rate.bucket);
      return reply(await createSession(workspace.organization.id, record), 200, origin);
    }

    if (action === "inspectInvitation") {
      const invitationId = String(body.invitationId || "");
      const token = String(body.token || "");
      const rate = await consumeAttempt(request, "inspect-invitation", invitationId || "missing", 30, 600);
      if (!rate.allowed) return reply({ valid: false }, 429, origin);
      const invitation = await inspectInvitation(workspace, invitationId, token);
      if (!invitation) return reply({ valid: false }, 200, origin);
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
      const invitationId = String(body.invitationId || "");
      const rate = await consumeAttempt(request, "accept-invitation", invitationId || "missing", 10, 600);
      if (!rate.allowed) {
        return reply({ error: "Zu viele Versuche. Bitte später erneut versuchen.", retryAfter: rate.retryAfter }, 429, origin);
      }
      const result = await acceptInvitation(workspace, body);
      await clearAttempt(rate.bucket);
      return reply(result, 200, origin);
    }

    if (action === "logout") {
      const token = String(body.token || "");
      if (token.length === 64) await service.rpc("demo_logout", { p_token: token });
      return reply({ ok: true }, 200, origin);
    }

    return reply({ error: "Unknown action" }, 400, origin);
  } catch (error: any) {
    return reply({ error: error instanceof Error ? error.message : String(error) }, Number(error?.status || 500), origin);
  }
});
