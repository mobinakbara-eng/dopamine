import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const service = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const DEFAULT_ORIGIN = "https://aora-v8-hardening.vercel.app";
const PREVIEW_SUFFIX = "-mobins-projects-4f428afa.vercel.app";
const ORIGINS = new Set([DEFAULT_ORIGIN, "https://aora-v8-final.vercel.app", "https://aora-workforce.vercel.app"]);

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
    "cache-control": "no-store",
    Vary: "Origin",
  };
}
function out(body: unknown, status = 200, origin: string | null = null) {
  return new Response(JSON.stringify(body), { status, headers: { ...headers(origin), "content-type": "application/json; charset=utf-8" } });
}
function trim(value: unknown, size: number) {
  return String(value ?? "").slice(0, size);
}
async function digest(value: string) {
  const result = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(result), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (request: Request) => {
  const origin = request.headers.get("origin");
  if (request.method === "OPTIONS") return new Response("ok", { headers: headers(origin) });
  if (request.method !== "POST" || !allowed(origin)) return out({ error: "not_allowed" }, 403, origin);
  try {
    const body = await request.json();
    if (body.action === "health") {
      const { count } = await service.from("organizations").select("id", { count: "exact", head: true }).eq("status", "active");
      return out({ ok: true, service: "aora-v8-pilot", version: "8.1.0-pilot", activeOrganizations: count ?? 0, checkedAt: new Date().toISOString() }, 200, origin);
    }
    const token = trim(body.token, 64);
    let organizationId: null | string = null;
    let subjectId: null | string = null;
    let role: null | string = null;
    if (token.length === 64) {
      const { data } = await service.rpc("validate_demo_session", { p_token: token });
      if (data?.length) {
        organizationId = data[0].organization_id;
        subjectId = data[0].subject_id;
        role = data[0].role;
      }
    }
    const identity = await digest(`${request.headers.get("x-forwarded-for") || "unknown"}:${organizationId || "public"}`);
    const { data: limit } = await service.rpc("aora_consume_rate_limit", { p_bucket: `pilot-monitor:${identity}`, p_window_seconds: 300, p_limit: 30 });
    const allowedRate = Array.isArray(limit) ? limit[0]?.allowed : limit?.allowed;
    if (!allowedRate) return out({ ok: false, error: "rate_limited" }, 429, origin);
    const message = trim(body.message, 1000);
    if (!message) return out({ error: "message_required" }, 400, origin);
    const metadata = body.metadata && typeof body.metadata === "object" ? body.metadata : {};
    await service.from("pilot_error_events").insert({
      organization_id: organizationId,
      session_subject_id: subjectId,
      role,
      severity: ["warning", "error", "fatal"].includes(body.severity) ? body.severity : "error",
      message,
      stack: trim(body.stack, 8000),
      url: trim(body.url, 1000),
      build_sha: trim(body.buildSha, 80),
      metadata: { ...metadata, userAgent: trim(request.headers.get("user-agent"), 300) },
    });
    return out({ ok: true }, 202, origin);
  } catch (error) {
    console.error(error);
    return out({ ok: false }, 202, origin);
  }
});