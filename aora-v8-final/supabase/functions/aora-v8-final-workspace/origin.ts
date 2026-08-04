const FALLBACK_APP_ORIGIN = "https://dopamine-blond.vercel.app";
const TEAM_PREVIEW_SUFFIX = "-mobins-projects-4f428afa.vercel.app";

export const canonicalAppOrigin = () => {
  const configured = String(Deno.env.get("AORA_APP_ORIGIN") || "").trim();
  try {
    const parsed = new globalThis.URL(configured || FALLBACK_APP_ORIGIN);
    const localHttp = parsed.protocol === "http:" &&
      ["localhost", "127.0.0.1"].includes(parsed.hostname);
    if (parsed.protocol !== "https:" && !localHttp) {
      return FALLBACK_APP_ORIGIN;
    }
    return parsed.origin;
  } catch {
    return FALLBACK_APP_ORIGIN;
  }
};

export const allowedOrigin = (origin: string | null) => {
  if (!origin) return true;
  try {
    const url = new globalThis.URL(origin);
    const local = ["localhost", "127.0.0.1"].includes(url.hostname);
    if (local) return url.protocol === "http:";
    if (url.protocol !== "https:") return false;
    return url.origin === canonicalAppOrigin() ||
      url.hostname.endsWith(TEAM_PREVIEW_SUFFIX);
  } catch {
    return false;
  }
};

export const appOriginForRequest = (origin: string | null) => {
  if (origin && allowedOrigin(origin)) {
    const parsed = new globalThis.URL(origin);
    const stagingProject = String(Deno.env.get("SUPABASE_URL") || "").includes("xqgkawskftzurbujrpex");
    if (["localhost", "127.0.0.1"].includes(parsed.hostname) || stagingProject) return parsed.origin;
  }
  return canonicalAppOrigin();
};

export const cors = (origin: string | null) => ({
  "Access-Control-Allow-Origin": origin && allowedOrigin(origin)
    ? origin
    : "https://aora-workforce.vercel.app",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Vary": "Origin",
});

export const reply = (
  body: unknown,
  status = 200,
  origin: string | null = null,
) => new Response(JSON.stringify(body), {
  status,
  headers: {
    ...cors(origin),
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  },
});
