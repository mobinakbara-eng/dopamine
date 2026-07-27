import "jsr:@supabase/functions-js/edge-runtime.d.ts";
// @ts-ignore Remote Deno import.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const service = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const baseHeaders = {
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
  "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
};

function escapeHtml(value: unknown) {
  return String(value ?? "").replace(/[<>&"]/g, (character) => ({
    "<": "&lt;",
    ">": "&gt;",
    "&": "&amp;",
    '"': "&quot;",
  }[character] || character));
}

function html(body: string, status = 200) {
  return new Response(`<!doctype html>
<html lang="de">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>AoraAI Einladung</title>
</head>
<body style="margin:0;background:#f4f4f4;font-family:Arial,sans-serif;color:#111">
  <main style="max-width:560px;margin:64px auto;background:#fff;padding:36px;border-radius:18px">
    <div style="font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:#777;margin-bottom:16px">AoraAI Workforce</div>
    ${body}
  </main>
</body>
</html>`, {
    status,
    headers: { ...baseHeaders, "content-type": "text/html; charset=utf-8" },
  });
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...baseHeaders, "content-type": "application/json; charset=utf-8" },
  });
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (request: Request) => {
  try {
    const url = new URL(request.url);

    if (request.method === "GET") {
      const invitation = String(url.searchParams.get("invitation") || "");
      if (!/^invite_[a-zA-Z0-9-]{10,100}$/.test(invitation)) {
        return html("<h1>Einladung nicht verfügbar</h1><p>Der Einladungslink ist ungültig.</p>", 400);
      }

      return html(`
        <h1 style="font-size:26px;margin:0 0 18px">Einladung bestätigen</h1>
        <p style="line-height:1.65">Gib die E-Mail-Adresse ein, an die deine Aora-Einladung gesendet wurde.</p>
        <form method="post" style="margin-top:26px">
          <input type="hidden" name="invitation" value="${escapeHtml(invitation)}">
          <label style="display:block;font-size:14px;font-weight:700;margin-bottom:8px">E-Mail-Adresse</label>
          <input name="email" type="email" autocomplete="email" required maxlength="254" style="box-sizing:border-box;width:100%;padding:14px;border:1px solid #bbb;border-radius:10px;font-size:16px">
          <button type="submit" style="width:100%;margin-top:18px;background:#000;color:#fff;border:0;border-radius:11px;padding:15px;font-size:16px;font-weight:700;cursor:pointer">Weiter zur Aktivierung</button>
        </form>
        <p style="font-size:13px;line-height:1.6;color:#777;margin-top:24px">Aus Sicherheitsgründen wird die Aktivierungsadresse erst nach erfolgreicher E-Mail-Prüfung geöffnet.</p>
      `);
    }

    if (request.method !== "POST") {
      return json({ ok: false, error: "method_not_allowed" }, 405);
    }

    const form = await request.formData();
    const invitation = String(form.get("invitation") || "");
    const email = String(form.get("email") || "").trim().toLowerCase();

    if (!/^invite_[a-zA-Z0-9-]{10,100}$/.test(invitation) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return json({ ok: false, error: "claim_denied" }, 400);
    }

    const bucketHash = await sha256(`${invitation}:${email}`);
    const { data: limits, error: limitError } = await service.rpc("aora_consume_rate_limit", {
      p_bucket: `invite-claim:${bucketHash}`,
      p_window_seconds: 900,
      p_limit: 5,
    });

    if (limitError || !limits?.[0]?.allowed) {
      return json({ ok: false, error: "too_many_attempts" }, 429);
    }

    const { data, error } = await service.rpc("aora_claim_hardening_invite", {
      p_invitation_id: invitation,
      p_email: email,
    });

    if (error || !data?.[0]?.target_url) {
      return json({ ok: false, error: "claim_denied" }, 403);
    }

    return new Response(null, {
      status: 303,
      headers: { ...baseHeaders, location: data[0].target_url },
    });
  } catch {
    return json({ ok: false, error: "claim_failed" }, 500);
  }
});
