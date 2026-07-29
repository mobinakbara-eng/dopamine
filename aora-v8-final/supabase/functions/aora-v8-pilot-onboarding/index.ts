import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const APP_URL = "https://dopamine-mobins-projects-4f428afa.vercel.app";
const service = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const DEFAULT_ORIGIN = "https://aora-v8-hardening.vercel.app";
const PREVIEW_SUFFIX = "-mobins-projects-4f428afa.vercel.app";
const MAX_BODY_BYTES = 100_000;
const ORIGINS = new Set([DEFAULT_ORIGIN, "https://aora-v8-final.vercel.app", "https://aora-workforce.vercel.app"]);
const encoder = new TextEncoder();

function localHost(hostname: string) {
  const host = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  return ["localhost", "0.0.0.0", "::1"].includes(host) || /^127(?:\.\d{1,3}){3}$/.test(host);
}
function allowed(origin: string | null) {
  if (!origin || origin === "null") return true;
  try {
    const parsed = new globalThis.URL(origin);
    return ORIGINS.has(parsed.origin) ||
      (parsed.protocol === "https:" && parsed.hostname.endsWith(PREVIEW_SUFFIX)) ||
      (parsed.protocol === "http:" && localHost(parsed.hostname));
  } catch {
    return false;
  }
}
function headers(origin: string | null) {
  return {
    "Access-Control-Allow-Origin": origin && allowed(origin) ? origin : DEFAULT_ORIGIN,
    "Access-Control-Allow-Headers": "content-type",
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
  return new Response(JSON.stringify(body), { status, headers: headers(origin) });
}
function fail(message: string, status = 400): never {
  throw Object.assign(new Error(message), { status });
}
function hex(bytes: Uint8Array) {
  return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
}
function randomHex(size = 32) {
  return hex(crypto.getRandomValues(new Uint8Array(size)));
}
function sixDigitCode() {
  return String(100000 + (crypto.getRandomValues(new Uint32Array(1))[0] % 900000));
}
async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(value));
  return hex(new Uint8Array(digest));
}
function clean(value: unknown, max = 120) {
  return String(value ?? "").trim().slice(0, max);
}
function validEmail(value: unknown) {
  const address = clean(value, 254).toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(address)) fail("Eine gültige E-Mail-Adresse ist erforderlich.");
  return address;
}
function slugify(value: string) {
  return value.normalize("NFKD").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 42) || "unternehmen";
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

Deno.serve(async (request: Request) => {
  const origin = request.headers.get("origin");
  if (request.method === "OPTIONS") return new Response("ok", { headers: headers(origin) });
  if (request.method !== "POST" || !allowed(origin)) return reply({ error: "not_allowed" }, 403, origin);
  try {
    const body = await readBody(request);
    if (body.action === "health") {
      return reply({ ok: true, version: "8.1.0-pilot", steps: ["Unternehmen", "Standort", "Manager", "Kiosk"] }, 200, origin);
    }
    if (body.action !== "provision") return reply({ error: "Unknown action" }, 400, origin);

    const code = clean(body.code, 128);
    if (code.length < 12) fail("Onboarding-Code ist ungültig.", 401);
    const company = body.company || {};
    const location = body.location || {};
    const manager = body.manager || {};
    const kiosk = body.kiosk || {};
    const companyName = clean(company.name, 120);
    const billingEmail = validEmail(company.billingEmail);
    const timezone = clean(company.timezone || "Europe/Berlin", 80);
    const language = clean(company.language || "de", 10);
    const locationName = clean(location.name, 120);
    const managerName = clean(manager.name, 120);
    const managerEmail = validEmail(manager.email);
    if (companyName.length < 2) fail("Unternehmensname fehlt.");
    if (locationName.length < 2) fail("Standortname fehlt.");
    if (managerName.length < 2) fail("Managername fehlt.");

    const radius = Math.max(20, Math.min(1000, Number(location.geofenceRadius || 100)));
    const latitude = Number(location.latitude);
    const longitude = Number(location.longitude);
    if (
      !Number.isFinite(latitude) || latitude < -90 || latitude > 90 ||
      !Number.isFinite(longitude) || longitude < -180 || longitude > 180 ||
      (latitude === 0 && longitude === 0)
    ) fail("Gültige GPS-Koordinaten für den Standort sind erforderlich.");
    const organizationSlug = `${slugify(companyName)}-${randomHex(3)}`;
    const part = randomHex(4);
    const locationId = `loc_${part}`;
    const managerId = `admin_${crypto.randomUUID()}`;
    const deviceId = `kiosk_${crypto.randomUUID()}`;
    const invitationId = `invite_${crypto.randomUUID()}`;
    const invitationToken = randomHex(32);
    const activationCode = sixDigitCode();
    const invitationExpiresAt = new Date(Date.now() + 7 * 86400000).toISOString();
    const activationExpiresAt = new Date(Date.now() + 24 * 3600000).toISOString();
    const now = new Date().toISOString();

    const state = {
      company: { name: companyName, businessType: clean(company.businessType, 80), billingEmail, timezone, language, address: company.address || {} },
      settings: { timezone, language, maxDailyMinutes: 600, requiredBreakMinutes: 30, geofenceRadius: radius },
      meta: { variant: "aora-8.1.0-pilot", tenantSource: "session", revision: 1, createdAt: now },
      locations: [{
        id: locationId, name: locationName, city: clean(location.city, 80), address: location.address || {},
        costCenter: clean(location.costCenter, 60), openingHours: location.openingHours || {},
        latitude, longitude, gps: { lat: latitude, lng: longitude }, gpsConfigured: true,
        geofenceRadius: radius, active: true,
      }],
      admins: [{ id: managerId, name: managerName, email: managerEmail, role: "Manager", scope: "manager", locationIds: [locationId], active: true, status: "pending", createdAt: now }],
      employees: [],
      kioskDevices: [{ id: deviceId, name: clean(kiosk.name || "Kiosk 1", 120), locationId, active: true, locked: false, activationCodeHash: await sha256(activationCode), activationVersion: 1, createdAt: now }],
      invitations: [{ id: invitationId, kind: "manager", name: managerName, email: managerEmail, status: "pending", subjectId: managerId, locationIds: [locationId], expiresAt: invitationExpiresAt, createdAt: now, emailStatus: "prepared" }],
      shifts: [], timeEntries: [], leaveRequests: [], correctionRequests: [], announcements: [], notifications: [],
      audit: [{ id: `audit_${crypto.randomUUID()}`, action: "organization.provisioned", actor: "Pilot Onboarding", entity: "organization", entityId: organizationSlug, createdAt: now }],
      clockRequests: [], availabilityRules: [], shiftRequests: [], checklistTemplates: [], checklistAssignments: [], dailyLogs: [], timesheetPeriods: [], staffingRequirements: [], shiftFeedback: [], shiftTemplates: [],
    };

    const { data, error } = await service.rpc("aora_provision_pilot_organization", {
      p_code_hash: await sha256(code), p_slug: organizationSlug, p_name: companyName, p_timezone: timezone, p_billing_email: billingEmail, p_state: state,
      p_company: { businessType: clean(company.businessType, 80), language, address: company.address || {} },
      p_invitation_id: invitationId, p_invitation_token_hash: await sha256(invitationToken), p_invitation_expires_at: invitationExpiresAt, p_created_by: "pilot-onboarding",
    });
    if (error) {
      const message = String(error.message || error);
      if (message.includes("onboarding_code_invalid")) fail("Onboarding-Code ist ungültig oder abgelaufen.", 401);
      if (message.includes("organization_or_invitation_exists")) fail("Unternehmen konnte nicht eindeutig angelegt werden.", 409);
      throw error;
    }

    const invitationUrl = new globalThis.URL("/arbeitgeber/", APP_URL);
    invitationUrl.searchParams.set("workspace", organizationSlug);
    invitationUrl.searchParams.set("invitation", invitationId);
    invitationUrl.searchParams.set("token", invitationToken);
    return reply({
      organizationId: data, workspaceSlug: organizationSlug, locationId, managerId, deviceId,
      managerInvitation: { id: invitationId, email: managerEmail, expiresAt: invitationExpiresAt, inviteUrl: invitationUrl.toString() },
      kioskActivation: { code: activationCode, expiresAt: activationExpiresAt },
      subscription: { plan: "pilot", status: "trial" },
    }, 201, origin);
  } catch (error: any) {
    return reply({ error: error instanceof Error ? error.message : String(error) }, Number(error?.status || 500), origin);
  }
});
