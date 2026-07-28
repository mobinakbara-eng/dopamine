import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CORE_URL = `${SUPABASE_URL}/functions/v1/aora-v8-pilot-compliance`;
const DEFAULT_ORIGIN = "https://aora-v8-hardening.vercel.app";
const PREVIEW_SUFFIX = "-mobins-projects-4f428afa.vercel.app";
const MAX_BODY_BYTES = 2_500_000;
const EXACT_ORIGINS = new Set([
  DEFAULT_ORIGIN,
  "https://aora-v8-final.vercel.app",
  "https://aora-workforce.vercel.app",
]);

function localHost(hostname: string) {
  const host = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  return ["localhost", "0.0.0.0", "::1"].includes(host) || /^127(?:\.\d{1,3}){3}$/.test(host);
}
function originAllowed(origin: string | null) {
  if (!origin || origin === "null") return true;
  try {
    const parsed = new globalThis.URL(origin);
    return EXACT_ORIGINS.has(parsed.origin) ||
      (parsed.protocol === "https:" && parsed.hostname.endsWith(PREVIEW_SUFFIX)) ||
      (parsed.protocol === "http:" && localHost(parsed.hostname));
  } catch {
    return false;
  }
}
function cors(origin: string | null) {
  return {
    "Access-Control-Allow-Origin": origin && originAllowed(origin) ? origin : DEFAULT_ORIGIN,
    "Access-Control-Allow-Headers": "content-type",
    "Access-Control-Allow-Methods": "POST,OPTIONS",
    "Access-Control-Allow-Private-Network": "true",
    "Access-Control-Allow-Expose-Headers": "content-disposition,x-aora-export-checksum",
    "Access-Control-Max-Age": "600",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
    Vary: "Origin",
  };
}
function json(body: unknown, status: number, origin: string | null) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors(origin), "content-type": "application/json; charset=utf-8" },
  });
}

Deno.serve(async (request: Request) => {
  const origin = request.headers.get("origin");
  if (request.method === "OPTIONS") return new Response("ok", { headers: cors(origin) });
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405, origin);
  if (!originAllowed(origin)) return json({ error: "Origin not allowed" }, 403, origin);

  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > MAX_BODY_BYTES) return json({ error: "Request too large" }, 413, origin);
  try {
    JSON.parse(text || "{}");
  } catch {
    return json({ error: "Invalid request" }, 400, origin);
  }

  try {
    const upstream = await fetch(CORE_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${SERVICE_KEY}`,
        apikey: SERVICE_KEY,
      },
      body: text,
    });
    const responseHeaders = new Headers(cors(origin));
    for (const name of ["content-type", "content-disposition", "x-aora-export-checksum"]) {
      const value = upstream.headers.get(name);
      if (value) responseHeaders.set(name, value);
    }
    return new Response(upstream.body, { status: upstream.status, headers: responseHeaders });
  } catch (error) {
    console.error("Aora compliance proxy failed", error);
    return json({ error: "Compliance service unavailable" }, 503, origin);
  }
});