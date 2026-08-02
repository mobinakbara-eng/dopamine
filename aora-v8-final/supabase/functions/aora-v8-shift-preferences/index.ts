import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";

const URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const DEFAULT_ORIGIN = "https://dopamine-blond.vercel.app";
const PREVIEW_SUFFIX = "-mobins-projects-4f428afa.vercel.app";
const EXACT_ORIGINS = new Set([
  DEFAULT_ORIGIN,
  "https://aora-workforce.vercel.app",
  "https://dopamine-mobins-projects-4f428afa.vercel.app",
  "https://dopamine-git-main-mobins-projects-4f428afa.vercel.app"
]);
const service = createClient(URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

function allowedOrigin(origin: string | null) {
  if (!origin || origin === "null" || EXACT_ORIGINS.has(origin)) return true;
  try {
    const parsed = new globalThis.URL(origin);
    return (parsed.protocol === "https:" && parsed.hostname.endsWith(PREVIEW_SUFFIX))
      || (parsed.protocol === "http:" && ["localhost", "127.0.0.1"].includes(parsed.hostname));
  } catch { return false; }
}
function responseHeaders(origin: string | null) {
  return {
    "access-control-allow-origin": origin && allowedOrigin(origin) ? origin : DEFAULT_ORIGIN,
    "access-control-allow-headers": "content-type,authorization,apikey,x-client-info,x-request-id",
    "access-control-allow-methods": "POST,OPTIONS",
    "access-control-max-age": "600",
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    "vary": "Origin"
  };
}
function reply(body: unknown, status = 200, origin: string | null = null) {
  return new Response(JSON.stringify(body), { status, headers: responseHeaders(origin) });
}
function messageFor(error: any, fallback = "Interner Fehler.") {
  if (error instanceof Error && error.message) return error.message;
  if (error && typeof error === "object") return String(error.message || error.details || error.hint || fallback);
  return error == null ? fallback : String(error);
}
function statusFor(error: any) {
  const code = String(error?.code || "");
  const message = messageFor(error);
  if (code === "28000" || /Sitzung.*ungültig|abgelaufen/i.test(message)) return 401;
  if (code === "42501") return 403;
  if (code === "P0002") return 404;
  if (["23505", "40001"].includes(code) || /bereits|nicht mehr offen|überschneidet/i.test(message)) return 409;
  if (["22023", "P0001"].includes(code)) return 422;
  return 500;
}

Deno.serve(async (request: Request) => {
  const origin = request.headers.get("origin");
  if (request.method === "OPTIONS") return new Response("ok", { headers: responseHeaders(origin) });
  if (request.method !== "POST") return reply({ error: "Method not allowed" }, 405, origin);
  if (origin && !allowedOrigin(origin)) return reply({ error: "Origin not allowed" }, 403, origin);

  try {
    const body = await request.json();
    const action = String(body.action || "");
    if (!["create", "cancel", "decide"].includes(action)) return reply({ error: "Unbekannte Aktion." }, 400, origin);
    const payload = action === "create"
      ? (body.preference || {})
      : action === "decide"
        ? { decision: body.decision, reason: body.reason || "", shift: body.shift || null }
        : {};
    const result = await service.rpc("aora_shift_preference_action", {
      p_token: String(body.token || ""),
      p_action: action,
      p_request_id: body.id ? String(body.id) : null,
      p_payload: payload,
      p_idempotency_key: String(body.idempotencyKey || crypto.randomUUID())
    });
    if (result.error) return reply({ error: messageFor(result.error), code: result.error.code || null }, statusFor(result.error), origin);
    return reply(result.data || {}, 200, origin);
  } catch (error: any) {
    const message = messageFor(error);
    console.warn("aora-shift-preference-rejected", { status: error?.status || 500, message });
    return reply({ error: message }, Number(error?.status || 500), origin);
  }
});
