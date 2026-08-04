import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const service = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const DEFAULT_ORIGIN = "https://aora-v8-hardening.vercel.app";
const TEAM_SUFFIX = "-mobins-projects-4f428afa.vercel.app";
const EXACT = new Set([DEFAULT_ORIGIN, "https://aora-v8-final.vercel.app", "https://aora-workforce.vercel.app"]);
const ALLOWED_KEYS = new Set(["locations", "admins", "employees", "shifts", "timeEntries", "leaveRequests", "correctionRequests", "announcements", "notifications", "kioskDevices", "audit", "clockRequests", "invitations", "compliance"]);
const ALLOWED_ACTOR_ROLES = new Set(["admin", "employee", "kiosk"]);
const MAX_BODY_BYTES = 16 * 1024;

function allowed(origin: string | null) {
  if (!origin) return true;
  if (EXACT.has(origin)) return true;
  try {
    const url = new globalThis.URL(origin);
    return ["localhost", "127.0.0.1"].includes(url.hostname) ||
      (url.protocol === "https:" && url.hostname.endsWith(TEAM_SUFFIX));
  } catch {
    return false;
  }
}
function headers(origin: string | null, extra: Record<string, string> = {}) {
  return {
    "Access-Control-Allow-Origin": origin && allowed(origin) ? origin : DEFAULT_ORIGIN,
    "Access-Control-Allow-Headers": "content-type,authorization,apikey",
    "Access-Control-Allow-Methods": "POST,OPTIONS",
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    Vary: "Origin",
    ...extra,
  };
}
function json(body: unknown, status = 200, origin: string | null = null, extra: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), { status, headers: headers(origin, extra) });
}
function fail(message: string, status = 400): never {
  throw Object.assign(new Error(message), { status });
}
function cleanEvent(value: unknown) {
  const event = String(value || "WORKSPACE_CHANGED").toUpperCase();
  if (!/^[A-Z][A-Z0-9_]{0,63}$/.test(event)) fail("Ungültiger Ereignistyp.", 400);
  return event;
}
function cleanKeys(value: unknown) {
  return [...new Set((Array.isArray(value) ? value : []).map(String).filter((key) => ALLOWED_KEYS.has(key)))].slice(0, 20);
}
async function readBody(request: Request) {
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > MAX_BODY_BYTES) fail("Anfrage ist zu groß.", 413);
  try {
    return JSON.parse(text || "{}");
  } catch {
    fail("Ungültiges JSON.", 400);
  }
}
async function digest(value: string) {
  const result = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(result), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
async function context(token: string) {
  if (token.length !== 64) fail("Sitzungstoken fehlt.", 401);
  const { data, error } = await service.rpc("validate_demo_session", { p_token: token });
  if (error || !data?.length) fail("Sitzung ist ungültig oder abgelaufen.", 401);
  const session = data[0];
  if (!session.organization_id || !session.subject_id || !ALLOWED_ACTOR_ROLES.has(String(session.role))) {
    fail("Akteur darf keine Realtime-Aktualisierung senden.", 403);
  }
  return session;
}
async function consumeRateLimit(session: any, token: string) {
  const tokenHash = await digest(token);
  const bucket = `realtime-broadcast:${session.organization_id}:${session.subject_id}:${tokenHash}`;
  const { data, error } = await service.rpc("aora_consume_rate_limit", {
    p_bucket: bucket,
    p_window_seconds: 60,
    p_limit: 120,
  });
  if (error) fail("Realtime-Schutz ist vorübergehend nicht verfügbar.", 503);
  const result = Array.isArray(data) ? data[0] : data;
  if (!result?.allowed) {
    const retryAfter = Math.max(1, Math.trunc(Number(result?.retry_after_seconds) || 60));
    throw Object.assign(new Error("Zu viele Realtime-Anfragen."), { status: 429, retryAfter });
  }
}
async function requireCurrentRevision(organizationId: string, value: unknown) {
  const revision = Number(value);
  if (!Number.isSafeInteger(revision) || revision < 1) fail("Ungültige Workspace-Revision.", 400);
  const { data, error } = await service.from("workspace_changes")
    .select("revision")
    .eq("organization_id", organizationId)
    .maybeSingle();
  if (error || !data) fail("Workspace-Revision ist nicht verfügbar.", 503);
  if (Number(data.revision) !== revision) fail("Workspace-Revision ist nicht aktuell.", 409);
  return revision;
}
async function send(messages: any[]) {
  for (let index = 0; index < messages.length; index += 100) {
    const batch = messages.slice(index, index + 100);
    const response = await fetch(`${SUPABASE_URL}/realtime/v1/api/broadcast`, {
      method: "POST",
      headers: { "content-type": "application/json", apikey: SERVICE_KEY, authorization: `Bearer ${SERVICE_KEY}` },
      body: JSON.stringify({ messages: batch }),
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Realtime Broadcast HTTP ${response.status}: ${text.slice(0, 160)}`);
    }
  }
}

Deno.serve(async (request: Request) => {
  const origin = request.headers.get("origin");
  if (request.method === "OPTIONS") return new Response("ok", { headers: headers(origin) });
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405, origin);
  if (origin && !allowed(origin)) return json({ error: "Origin not allowed" }, 403, origin);
  try {
    const body = await readBody(request);
    const token = String(body.token || "");
    const session = await context(token);
    await consumeRateLimit(session, token);
    const revision = await requireCurrentRevision(session.organization_id, body.revision);
    const eventType = cleanEvent(body.eventType);
    const keys = cleanKeys(body.keys);
    const { data: rows, error } = await service.rpc("aora_active_session_topics", { p_organization_id: session.organization_id });
    if (error) throw error;
    const payload = { revision, eventType, keys, reconcile: keys.length === 0, changedAt: new Date().toISOString() };
    const messages = (rows || []).map((row: any) => ({ topic: String(row.topic), event: "workspace-change", payload }));
    if (messages.length) await send(messages);
    return json({ ok: true, deliveredTopics: messages.length }, 200, origin);
  } catch (error: any) {
    const status = Number(error?.status || 500);
    const extra: Record<string, string> = status === 429 ? { "Retry-After": String(error?.retryAfter || 60) } : {};
    return json({ error: status >= 500 ? "Realtime-Dienst ist vorübergehend nicht verfügbar." : error instanceof Error ? error.message : String(error) }, status, origin, extra);
  }
});
