import "jsr:@supabase/functions-js/edge-runtime.d.ts";
// @ts-ignore remote Deno import
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";

const URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const WORKSPACE_SLUG = "aora-v8-hardening-demo";
const UPSTREAM = `${URL}/functions/v1/aora-v8-hardening-workspace`;
const MAX_BODY_BYTES = 2_500_000;
const UPSTREAM_TIMEOUT_MS = 20_000;
const DEFAULT_ORIGIN = "https://aora-v8-hardening.vercel.app";
const TEAM_PREVIEW_SUFFIX = "-mobins-projects-4f428afa.vercel.app";
const EXACT_ORIGINS = new Set([
  "https://aora-v8-hardening.vercel.app",
  "https://aora-v8-final.vercel.app",
  "https://aora-workforce.vercel.app",
]);
const KIOSK_TARGETS = new Set(["in", "out", "pause", "resume"]);

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

async function readBody(request: Request) {
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > MAX_BODY_BYTES) {
    throw Object.assign(new Error("Request too large"), { status: 413 });
  }
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    throw Object.assign(new Error("Ungültige Anfrage."), { status: 400 });
  }
}

async function validateKioskTransition(body: any) {
  if (body.action !== "apply" || body.event?.type !== "KIOSK_TRANSITION") return;

  const token = String(body.token || "");
  if (token.length !== 64) {
    throw Object.assign(new Error("Sitzungstoken fehlt."), { status: 401 });
  }

  const { data: sessions, error: sessionError } = await service.rpc("validate_demo_session", { p_token: token });
  if (sessionError || !sessions?.length) {
    throw Object.assign(new Error("Sitzung ist ungültig oder abgelaufen."), { status: 401 });
  }
  const session = sessions[0];
  if (session.role !== "kiosk" || !session.location_id) {
    throw Object.assign(new Error("Kiosk-Sitzung erforderlich."), { status: 403 });
  }

  const { data: organization, error: organizationError } = await service
    .from("organizations")
    .select("id")
    .eq("id", session.organization_id)
    .eq("slug", WORKSPACE_SLUG)
    .eq("status", "active")
    .single();
  if (organizationError || !organization) {
    throw Object.assign(new Error("Diese Sitzung gehört nicht zur Hardening-Version."), { status: 403 });
  }

  const { data: snapshot, error: snapshotError } = await service
    .from("workspace_snapshots")
    .select("state")
    .eq("organization_id", organization.id)
    .single();
  if (snapshotError || !snapshot) throw new Error("Arbeitsbereich konnte nicht geladen werden.");

  const state: any = snapshot.state || {};
  const device = (state.kioskDevices || []).find((item: any) =>
    item.id === session.subject_id &&
    item.locationId === session.location_id &&
    item.active !== false
  );
  if (!device || device.locked === true) {
    throw Object.assign(new Error("Dieses Kiosk-Gerät ist gesperrt oder nicht aktiv."), { status: 423 });
  }

  const employeeId = String(body.event.employeeId || "");
  const employee = (state.employees || []).find((item: any) =>
    item.id === employeeId &&
    item.locationId === session.location_id &&
    item.active !== false &&
    item.status !== "pending" &&
    item.status !== "revoked"
  );
  if (!employee) {
    throw Object.assign(new Error("Mitarbeiter ist für dieses Kiosk nicht freigeschaltet."), { status: 403 });
  }

  const target = String(body.event.target || "");
  if (!KIOSK_TARGETS.has(target)) {
    throw Object.assign(new Error("Ungültiger Stempelstatus."), { status: 400 });
  }

  const activeEntry = (state.timeEntries || []).find((item: any) =>
    item.employeeId === employeeId && ["live", "paused"].includes(item.status)
  );
  const normalizedTarget = target === "in" && activeEntry?.status === "paused" ? "resume" : target;
  const allowed = !activeEntry
    ? normalizedTarget === "in"
    : activeEntry.status === "live"
      ? ["pause", "out"].includes(normalizedTarget)
      : ["resume", "out"].includes(normalizedTarget);
  if (!allowed) {
    throw Object.assign(new Error("Dieser Statuswechsel ist aktuell nicht möglich."), { status: 409 });
  }
}

async function forward(body: any, origin: string | null) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
  try {
    const response = await fetch(UPSTREAM, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${SERVICE_KEY}`,
        apikey: SERVICE_KEY,
        ...(origin ? { origin } : {}),
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const headers = new Headers(response.headers);
    headers.set("cache-control", "no-store");
    headers.set("x-aora-kiosk-guard", "active");
    return new Response(response.body, { status: response.status, headers });
  } catch (error: any) {
    if (error?.name === "AbortError") {
      throw Object.assign(new Error("Kiosk-Anfrage hat zu lange gedauert."), { status: 504 });
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

Deno.serve(async (request) => {
  const origin = request.headers.get("origin");
  if (request.method === "OPTIONS") return new Response("ok", { headers: cors(origin) });
  if (request.method !== "POST") return reply({ error: "Method not allowed" }, 405, origin);
  if (origin && !allowedOrigin(origin)) return reply({ error: "Origin not allowed" }, 403, origin);

  try {
    const body = await readBody(request);
    await validateKioskTransition(body);
    return await forward(body, origin);
  } catch (error: any) {
    return reply({ error: error instanceof Error ? error.message : String(error) }, Number(error?.status || 500), origin);
  }
});
