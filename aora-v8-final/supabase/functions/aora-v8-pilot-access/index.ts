import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const DEFAULT_WORKSPACE = "aora-v8-hardening-demo";
const ITERATIONS = 210_000;
const MAX_BODY_BYTES = 20_000;
const PWNED_PASSWORDS_RANGE_URL = "https://api.pwnedpasswords.com/range";
const PWNED_PASSWORD_TIMEOUT_MS = 6_000;
const PWNED_PASSWORD_USER_AGENT = "Aora-Workforce-Staging/8.1.0";
const DEFAULT_ORIGIN = "https://aora-v8-hardening.vercel.app";
const PREVIEW_SUFFIX = "-mobins-projects-4f428afa.vercel.app";
const EXACT_ORIGINS = new Set([
  DEFAULT_ORIGIN,
  "https://aora-v8-final.vercel.app",
  "https://aora-workforce.vercel.app",
]);

const service = createClient(SUPABASE_URL, KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const encoder = new TextEncoder();

function hex(bytes: Uint8Array) {
  return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
}
function fromHex(value: string) {
  return Uint8Array.from(value.match(/.{1,2}/g) || [], (part) => parseInt(part, 16));
}
function randomHex(size = 32) {
  return hex(crypto.getRandomValues(new Uint8Array(size)));
}
async function sha256(value: string) {
  return hex(new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(value))));
}
async function sha1Upper(value: string) {
  return hex(new Uint8Array(await crypto.subtle.digest("SHA-1", encoder.encode(value)))).toUpperCase();
}
async function derive(password: string, salt: string, iterations = ITERATIONS) {
  const key = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: fromHex(salt), iterations },
    key,
    256,
  );
  return hex(new Uint8Array(bits));
}
function constantTimeEqual(left: unknown, right: unknown) {
  const a = String(left || "").trim().toLowerCase();
  const b = String(right || "").trim().toLowerCase();
  if (a.length !== b.length) return false;
  let result = 0;
  for (let index = 0; index < a.length; index += 1) result |= a.charCodeAt(index) ^ b.charCodeAt(index);
  return result === 0;
}
function passwordOk(value: string) {
  return value.length >= 10 && value.length <= 128 && /[a-z]/.test(value) && /[A-Z]/.test(value) && /\d/.test(value);
}
async function assertPasswordNotPwned(password: string) {
  const hash = await sha1Upper(password);
  const prefix = hash.slice(0, 5);
  const suffix = hash.slice(5);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PWNED_PASSWORD_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(`${PWNED_PASSWORDS_RANGE_URL}/${prefix}`, {
      headers: {
        Accept: "text/plain",
        "Add-Padding": "true",
        "User-Agent": PWNED_PASSWORD_USER_AGENT,
      },
      signal: controller.signal,
    });
  } catch {
    fail("Die sichere Passwortprüfung ist vorübergehend nicht verfügbar. Bitte erneut versuchen.", 503);
  } finally {
    clearTimeout(timeout);
  }
  if (!response.ok) fail("Die sichere Passwortprüfung ist vorübergehend nicht verfügbar. Bitte erneut versuchen.", 503);
  const breached = (await response.text()).split(/\r?\n/).some((line) => {
    const [candidate, count] = line.split(":");
    return candidate?.trim().toUpperCase() === suffix && Number(count || 0) > 0;
  });
  if (breached) fail("Dieses Passwort ist aus bekannten Datenlecks bekannt. Bitte wählen Sie ein anderes Passwort.", 400);
}
function privateOrLoopbackHost(hostname: string) {
  const host = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (["localhost", "0.0.0.0", "::1", "host.docker.internal"].includes(host)) return true;
  if (/^127(?:\.\d{1,3}){3}$/.test(host)) return true;
  if (/^10(?:\.\d{1,3}){3}$/.test(host)) return true;
  if (/^192\.168(?:\.\d{1,3}){2}$/.test(host)) return true;
  const match = host.match(/^172\.(\d{1,3})(?:\.\d{1,3}){2}$/);
  return Boolean(match && Number(match[1]) >= 16 && Number(match[1]) <= 31);
}
function originOk(origin: string | null) {
  if (!origin || origin === "null") return true;
  try {
    const parsed = new globalThis.URL(origin);
    if (EXACT_ORIGINS.has(parsed.origin)) return true;
    if (parsed.protocol === "https:" && parsed.hostname.endsWith(PREVIEW_SUFFIX)) return true;
    return parsed.protocol === "http:" && privateOrLoopbackHost(parsed.hostname);
  } catch {
    return false;
  }
}
function responseHeaders(origin: string | null) {
  return {
    "Access-Control-Allow-Origin": origin && originOk(origin) ? origin : DEFAULT_ORIGIN,
    "Access-Control-Allow-Headers": "content-type,authorization,apikey,x-client-info",
    "Access-Control-Allow-Methods": "POST,OPTIONS",
    "Access-Control-Allow-Private-Network": "true",
    "Access-Control-Max-Age": "600",
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
    Vary: "Origin",
  };
}
function reply(body: unknown, status = 200, origin: string | null = null) {
  return new Response(JSON.stringify(body), { status, headers: responseHeaders(origin) });
}
function fail(message: string, status = 400): never {
  throw Object.assign(new Error(message), { status });
}
async function readBody(request: Request) {
  const text = await request.text();
  if (encoder.encode(text).byteLength > MAX_BODY_BYTES) fail("Anfrage ist zu groß.", 413);
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    fail("Ungültige Anfrage.", 400);
  }
}
function clientIp(request: Request) {
  return request.headers.get("cf-connecting-ip") ||
    request.headers.get("x-real-ip") ||
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    "unknown";
}
async function consumeRateLimit(request: Request, slug: string, action: string, identifier: string, limit = 7, window = 600) {
  const bucket = await sha256(`${slug}:${clientIp(request)}:${action}:${identifier}`);
  const { data, error } = await service.rpc("aora_consume_rate_limit", {
    p_bucket: bucket,
    p_window_seconds: window,
    p_limit: limit,
  });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  return { allowed: Boolean(row?.allowed), retryAfter: Number(row?.retry_after_seconds || 0), bucket };
}
async function clearRateLimit(bucket: string) {
  await service.from("aora_login_rate_limits").delete().eq("bucket", bucket);
}
function workspaceSlug(body: any) {
  const slug = String(body.workspaceSlug || DEFAULT_WORKSPACE).trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]{2,62}$/.test(slug)) fail("Arbeitsbereich ist ungültig.", 400);
  return slug;
}
async function workspace(slug: string) {
  const { data: organization } = await service
    .from("organizations")
    .select("id,slug,name,status,timezone")
    .eq("slug", slug)
    .eq("status", "active")
    .maybeSingle();
  if (!organization) fail("Arbeitsbereich wurde nicht gefunden.", 404);
  const { data: snapshot } = await service
    .from("workspace_snapshots")
    .select("state,revision")
    .eq("organization_id", organization.id)
    .maybeSingle();
  if (!snapshot) fail("Arbeitsbereich konnte nicht geladen werden.", 404);
  return { organization, snapshot, state: snapshot.state || {} };
}
function accountRecord(state: any, email: string) {
  const normalized = email.toLowerCase();
  const admin = (state.admins || []).find((item: any) =>
    String(item.email || "").toLowerCase() === normalized && item.active !== false && item.status !== "revoked"
  );
  if (admin) {
    return {
      kind: "admin",
      record: admin,
      role: "admin",
      accessRole: admin.scope === "owner" ? "owner" : "manager",
      subjectId: String(admin.id),
      locationId: admin.locationIds?.[0] || admin.locationId || null,
    };
  }
  const employee = (state.employees || []).find((item: any) =>
    String(item.email || "").toLowerCase() === normalized && item.active !== false && item.status !== "revoked"
  );
  if (!employee) return null;
  return {
    kind: "employee",
    record: employee,
    role: "employee",
    accessRole: "employee",
    subjectId: String(employee.id),
    locationId: employee.locationId || null,
  };
}
async function createSession(organization: any, account: any) {
  const token = randomHex(32);
  const expiresAt = new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString();
  const { error } = await service.from("app_sessions").insert({
    organization_id: organization.id,
    role: account.role,
    subject_id: account.subjectId,
    location_id: account.locationId,
    token_hash: `\\x${await sha256(token)}`,
    expires_at: expiresAt,
  });
  if (error) throw error;
  return {
    token,
    organizationId: organization.id,
    organizationSlug: organization.slug,
    role: account.role,
    accessRole: account.accessRole,
    subjectId: account.subjectId,
    employeeId: account.role === "employee" ? account.subjectId : null,
    adminId: account.role === "admin" ? account.subjectId : null,
    locationId: account.locationId,
    expiresAt,
  };
}
async function inspectInvitation(context: any, invitationId: string, token: string) {
  if (!invitationId || token.length !== 64) return null;
  const invitation = (context.state.invitations || []).find((item: any) =>
    item.id === invitationId && item.status === "pending"
  );
  if (!invitation || new Date(invitation.expiresAt) <= new Date()) return null;
  const { data: tokenRow } = await service
    .from("aora_v8_final_invitation_tokens")
    .select("token_hash,expires_at,used_at,revoked_at")
    .eq("organization_id", context.organization.id)
    .eq("invitation_id", invitationId)
    .maybeSingle();
  if (!tokenRow || tokenRow.used_at || tokenRow.revoked_at || new Date(tokenRow.expires_at) <= new Date()) return null;
  return constantTimeEqual(await sha256(token), tokenRow.token_hash) ? invitation : null;
}
async function acceptInvitation(context: any, body: any) {
  const invitationId = String(body.invitationId || "");
  const token = String(body.token || "");
  const email = String(body.email || "").trim().toLowerCase();
  const password = String(body.password || "");
  if (!passwordOk(password)) fail("Das Passwort benötigt mindestens 10 Zeichen, Groß-/Kleinbuchstaben und eine Zahl.", 400);
  const invitation = await inspectInvitation(context, invitationId, token);
  if (!invitation || String(invitation.email || "").toLowerCase() !== email) fail("Einladung ist ungültig oder abgelaufen.", 401);
  const account = accountRecord(context.state, email);
  if (!account || account.subjectId !== String(invitation.subjectId) || account.record.status !== "pending") {
    fail("Eingeladenes Konto wurde nicht gefunden.", 404);
  }
  await assertPasswordNotPwned(password);
  const state = structuredClone(context.state);
  const acceptedAt = new Date().toISOString();
  state.invitations = (state.invitations || []).map((item: any) =>
    item.id === invitationId ? { ...item, status: "accepted", acceptedAt, emailStatus: "delivered" } : item
  );
  const collection = account.kind === "admin" ? "admins" : "employees";
  state[collection] = (state[collection] || []).map((item: any) =>
    item.id === account.subjectId ? { ...item, active: true, status: "active", acceptedAt } : item
  );
  const salt = randomHex(16);
  const passwordHash = await derive(password, salt);
  const sessionToken = randomHex(32);
  const sessionHash = await sha256(sessionToken);
  const { data, error } = await service.rpc("aora_activate_invitation_atomic", {
    p_organization_id: context.organization.id,
    p_expected_revision: Number(context.snapshot.revision),
    p_invitation_id: invitationId,
    p_token_hash: await sha256(token),
    p_subject_role: account.role,
    p_subject_id: account.subjectId,
    p_email: email,
    p_salt: salt,
    p_password_hash: passwordHash,
    p_iterations: ITERATIONS,
    p_state: state,
    p_session_token_hash: sessionHash,
    p_session_location_id: account.locationId,
    p_session_ttl_seconds: 43_200,
  });
  if (error) {
    const message = String(error.message || "");
    if (message.includes("invitation_invalid")) fail("Einladung ist ungültig oder abgelaufen.", 401);
    if (message.includes("revision_conflict")) fail("Einladung wurde parallel geändert. Bitte neu öffnen.", 409);
    fail("Aktivierung fehlgeschlagen.", 500);
  }
  return {
    token: sessionToken,
    organizationId: context.organization.id,
    organizationSlug: context.organization.slug,
    role: account.role,
    accessRole: account.accessRole,
    subjectId: account.subjectId,
    employeeId: account.role === "employee" ? account.subjectId : null,
    adminId: account.role === "admin" ? account.subjectId : null,
    locationId: account.locationId,
    expiresAt: data?.[0]?.session_expires_at,
  };
}

Deno.serve(async (request: Request) => {
  const origin = request.headers.get("origin");
  if (request.method === "OPTIONS") return new Response("ok", { headers: responseHeaders(origin) });
  if (request.method !== "POST") return reply({ error: "Method not allowed" }, 405, origin);
  if (origin && !originOk(origin)) {
    console.warn("Aora access rejected origin", origin);
    return reply({ error: "Origin not allowed" }, 403, origin);
  }
  try {
    const body = await readBody(request);
    const action = String(body.action || "");
    const slug = workspaceSlug(body);
    const context = await workspace(slug);

    if (action === "directory") {
      const rate = await consumeRateLimit(request, slug, "directory", "public", 30, 600);
      if (!rate.allowed) return reply({ error: "Zu viele Anfragen.", retryAfter: rate.retryAfter }, 429, origin);
      return reply({
        workspaceSlug: slug,
        organizationName: context.organization.name,
        admins: (context.state.admins || [])
          .filter((item: any) => item.active !== false && item.scope === "owner")
          .map((item: any) => ({ id: item.id, name: item.name, scope: "owner" })),
        kioskDevices: (context.state.kioskDevices || [])
          .filter((item: any) => item.active !== false)
          .map((item: any) => ({ id: item.id, name: item.name || "Kiosk" })),
      }, 200, origin);
    }

    if (action === "login") {
      const role = String(body.role || "");
      const subjectId = String(body.subjectId || "");
      if (role !== "kiosk" || !subjectId) return reply({ error: "PIN-Anmeldung ist nur für Kiosk-Geräte verfügbar." }, 403, origin);
      const rate = await consumeRateLimit(request, slug, "pin", subjectId);
      if (!rate.allowed) return reply({ error: "Zu viele Anmeldeversuche.", retryAfter: rate.retryAfter }, 429, origin);
      const device = (context.state.kioskDevices || []).find((item: any) =>
        item.id === subjectId && item.active !== false && !item.locked
      );
      if (!device) return reply({ error: "Ungültiger Zugang." }, 403, origin);
      const { data, error } = await service.rpc("demo_login", {
        p_workspace_slug: slug,
        p_role: "kiosk",
        p_subject_id: subjectId,
        p_pin: body.pin == null ? null : String(body.pin),
      });
      if (error || !data) return reply({ error: "PIN oder Aktivierungscode ist nicht korrekt." }, 401, origin);
      await clearRateLimit(rate.bucket);
      return reply({ ...data, accessRole: "kiosk", organizationSlug: slug }, 200, origin);
    }

    if (action === "passwordLogin") {
      const email = String(body.email || "").trim().toLowerCase();
      const password = String(body.password || "");
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || password.length > 128) {
        return reply({ error: "E-Mail oder Passwort ist nicht korrekt." }, 401, origin);
      }
      const rate = await consumeRateLimit(request, slug, "password", email);
      if (!rate.allowed) return reply({ error: "Zu viele Anmeldeversuche.", retryAfter: rate.retryAfter }, 429, origin);
      const account = accountRecord(context.state, email);
      const { data: credential } = await service
        .from("aora_v8_final_credentials")
        .select("subject_role,subject_id,salt,password_hash,iterations,active")
        .eq("organization_id", context.organization.id)
        .eq("email", email)
        .maybeSingle();
      let valid = false;
      if (
        account && account.record.status === "active" &&
        credential?.active && credential.subject_role === account.role && credential.subject_id === account.subjectId
      ) {
        valid = constantTimeEqual(await derive(password, credential.salt, Number(credential.iterations)), credential.password_hash);
      } else {
        await derive(password || "invalid-password", randomHex(16));
      }
      if (!valid || !account) return reply({ error: "E-Mail oder Passwort ist nicht korrekt." }, 401, origin);
      await clearRateLimit(rate.bucket);
      return reply(await createSession(context.organization, account), 200, origin);
    }

    if (action === "inspectInvitation") {
      const invitationId = String(body.invitationId || "");
      const token = String(body.token || "");
      const rate = await consumeRateLimit(request, slug, "inspect", invitationId || "missing", 30, 600);
      if (!rate.allowed) return reply({ valid: false }, 429, origin);
      const invitation = await inspectInvitation(context, invitationId, token);
      if (!invitation) return reply({ valid: false }, 200, origin);
      const [local, domain] = String(invitation.email || "").split("@");
      return reply({
        valid: true,
        workspaceSlug: slug,
        invitationId,
        name: invitation.name,
        kind: invitation.kind,
        emailHint: `${local?.slice(0, 2) || ""}•••@${domain || ""}`,
        expiresAt: invitation.expiresAt,
      }, 200, origin);
    }

    if (action === "acceptInvitation") {
      const invitationId = String(body.invitationId || "");
      const rate = await consumeRateLimit(request, slug, "accept", invitationId || "missing", 10, 600);
      if (!rate.allowed) return reply({ error: "Zu viele Versuche.", retryAfter: rate.retryAfter }, 429, origin);
      const result = await acceptInvitation(context, body);
      await clearRateLimit(rate.bucket);
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

