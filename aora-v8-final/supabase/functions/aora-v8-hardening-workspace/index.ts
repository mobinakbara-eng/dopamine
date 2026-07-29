import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CANONICAL_WORKSPACE = `${SUPABASE_URL}/functions/v1/aora-v8-final-workspace`;
const DEFAULT_ORIGIN = "https://aora-v8-hardening.vercel.app";
const PREVIEW_SUFFIX = "-mobins-projects-4f428afa.vercel.app";
const MAX_BODY_BYTES = 2_500_000;
const EXACT_ORIGINS = new Set([
  DEFAULT_ORIGIN,
  "https://aora-v8-final.vercel.app",
  "https://aora-workforce.vercel.app",
  "https://dopamine-mobins-projects-4f428afa.vercel.app",
]);

function allowedOrigin(origin: string | null) {
  if (!origin) return true;
  try {
    const parsed = new globalThis.URL(origin);
    if (EXACT_ORIGINS.has(parsed.origin)) return true;
    if (parsed.protocol === "https:" && parsed.hostname.endsWith(PREVIEW_SUFFIX)) return true;
    return parsed.protocol === "http:" && ["localhost", "127.0.0.1"].includes(parsed.hostname);
  } catch {
    return false;
  }
}

function headers(origin: string | null) {
  return {
    "Access-Control-Allow-Origin": origin && allowedOrigin(origin) ? origin : DEFAULT_ORIGIN,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Max-Age": "600",
    "cache-control": "no-store",
    "content-type": "application/json; charset=utf-8",
    "referrer-policy": "no-referrer",
    "x-content-type-options": "nosniff",
    Vary: "Origin",
  };
}

function reply(body: unknown, status: number, origin: string | null) {
  return new Response(JSON.stringify(body), { status, headers: headers(origin) });
}

Deno.serve(async (request: Request) => {
  const origin = request.headers.get("origin");
  if (request.method === "OPTIONS") return new Response("ok", { headers: headers(origin) });
  if (request.method !== "POST") return reply({ error: "Method not allowed" }, 405, origin);
  if (origin && !allowedOrigin(origin)) return reply({ error: "Origin not allowed" }, 403, origin);
  const contentLength = Number(request.headers.get("content-length") || 0);
  if (contentLength > MAX_BODY_BYTES) return reply({ error: "Request too large" }, 413, origin);

  const body = await request.text();
  if (new TextEncoder().encode(body).byteLength > MAX_BODY_BYTES) {
    return reply({ error: "Request too large" }, 413, origin);
  }

  try {
    const upstream = await fetch(CANONICAL_WORKSPACE, {
      method: "POST",
      headers: {
        authorization: `Bearer ${SERVICE_KEY}`,
        apikey: SERVICE_KEY,
        "content-type": "application/json",
        ...(origin && allowedOrigin(origin) ? { origin } : {}),
      },
      body,
    });
    return new Response(await upstream.arrayBuffer(), {
      status: upstream.status,
      headers: headers(origin),
    });
  } catch {
    return reply({ error: "Workspace ist vorübergehend nicht erreichbar." }, 502, origin);
  }
});
