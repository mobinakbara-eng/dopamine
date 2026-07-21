import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {
  allowedLocations,
  allowedOrigin,
  callLegacy,
  context,
  cors,
  guardLegacyEvent,
  reply,
  scopeState,
} from "./core.ts";
import { applyStructural, STRUCTURAL_TYPES } from "./structural.ts";

Deno.serve(async (request) => {
  const origin = request.headers.get("origin");
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: cors(origin) });
  }
  if (request.method !== "POST") {
    return reply({ error: "Method not allowed" }, 405, origin);
  }
  if (origin && !allowedOrigin(origin)) {
    return reply({ error: "Origin not allowed" }, 403, origin);
  }

  try {
    const body = await request.json();
    const token = String(body.token || "");
    if (!token) return reply({ error: "Sitzungstoken fehlt." }, 401, origin);

    const ctx = await context(token);
    const session = {
      organizationId: ctx.organization.id,
      role: ctx.session.role,
      accessRole: ctx.accessRole,
      subjectId: ctx.session.subject_id,
      employeeId: ctx.session.role === "employee"
        ? ctx.session.subject_id
        : null,
      adminId: ctx.session.role === "admin" ? ctx.session.subject_id : null,
      deviceId: ctx.session.role === "kiosk" ? ctx.session.subject_id : null,
      locationId: ctx.session.location_id,
      locationIds: [...allowedLocations(ctx)],
      expiresAt: ctx.session.expires_at,
    };

    if (body.action === "load") {
      if (ctx.accessRole === "owner" || ctx.accessRole === "manager") {
        return reply({
          state: scopeState(ctx, ctx.state),
          revision: ctx.snapshot.revision,
          session,
        }, 200, origin);
      }
      const data = await callLegacy({ action: "load", token });
      return reply({
        ...data,
        session: { ...data.session, ...session },
      }, 200, origin);
    }

    if (body.action !== "apply") {
      return reply({ error: "Unbekannte Aktion." }, 400, origin);
    }

    if (STRUCTURAL_TYPES.has(body.event?.type)) {
      const data = await applyStructural(
        ctx,
        body.event,
        Number(body.expectedRevision),
        origin,
      );
      return reply({ ...data, session }, 200, origin);
    }

    const securedEvent = guardLegacyEvent(ctx, body.event);
    const data = await callLegacy({
      action: "apply",
      token,
      event: securedEvent,
      expectedRevision: body.expectedRevision,
    });
    return reply({
      ...data,
      state: scopeState(ctx, data.state),
      session: { ...data.session, ...session },
    }, 200, origin);
  } catch (error: any) {
    return reply({
      error: error instanceof Error ? error.message : String(error),
      ...(error?.data || {}),
    }, Number(error?.status || 500), origin);
  }
});
