export const allowedOrigin = (origin: string | null) => {
  if (!origin) return true;
  try {
    const url = new globalThis.URL(origin);
    return url.hostname === "localhost" ||
      url.hostname === "127.0.0.1" ||
      url.hostname.endsWith(".vercel.app");
  } catch {
    return false;
  }
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
