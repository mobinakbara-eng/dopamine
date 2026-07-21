import {
  allowedOrigin,
  now,
  service,
} from "./core.ts";

const hex = (bytes: Uint8Array) =>
  Array.from(bytes).map((byte) => byte.toString(16).padStart(2, "0")).join("");

async function sha256(value: string) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return hex(new Uint8Array(digest));
}

export async function issueInvitationToken(
  ctx: any,
  invitation: any,
  accessRole: "manager" | "employee",
  origin: string | null,
) {
  const token = hex(crypto.getRandomValues(new Uint8Array(32)));
  const tokenHash = await sha256(token);
  const issuedAt = now();
  const { error } = await service
    .from("aora_v8_final_invitation_tokens")
    .upsert({
      organization_id: ctx.organization.id,
      invitation_id: invitation.id,
      token_hash: tokenHash,
      expires_at: invitation.expiresAt,
      used_at: null,
      revoked_at: null,
      updated_at: issuedAt,
    }, { onConflict: "organization_id,invitation_id" });
  if (error) throw error;

  const appOrigin = origin && allowedOrigin(origin)
    ? origin
    : "http://localhost:3000";
  const route = accessRole === "manager" ? "arbeitgeber/" : "arbeitnehmer/";
  const inviteUrl = `${appOrigin}/${route}?invitation=${encodeURIComponent(invitation.id)}&token=${encodeURIComponent(token)}`;
  const roleLabel = accessRole === "manager" ? "Manager / Arbeitgeber" : "Mitarbeiter";
  const subject = `Einladung zu ${ctx.state.company?.name || "AoraAI Workforce"}`;
  const body = [
    `Hallo ${invitation.name},`,
    "",
    `du wurdest als ${roleLabel} zu ${ctx.state.company?.name || "AoraAI Workforce"} eingeladen.`,
    "Öffne den folgenden einmaligen Link und lege dein persönliches Passwort fest:",
    "",
    inviteUrl,
    "",
    `Der Link ist bis ${new Intl.DateTimeFormat("de-DE", {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: ctx.state.company?.timezone || "Europe/Berlin",
    }).format(new Date(invitation.expiresAt))} gültig.`,
    "",
    "Falls du diese Einladung nicht erwartest, kannst du die E-Mail ignorieren.",
  ].join("\n");

  return {
    invitationId: invitation.id,
    email: invitation.email,
    name: invitation.name,
    accessRole,
    inviteUrl,
    subject,
    body,
    expiresAt: invitation.expiresAt,
  };
}

export async function revokeInvitationToken(ctx: any, invitationId: string) {
  const timestamp = now();
  const { error } = await service
    .from("aora_v8_final_invitation_tokens")
    .update({ revoked_at: timestamp, updated_at: timestamp })
    .eq("organization_id", ctx.organization.id)
    .eq("invitation_id", invitationId);
  if (error) throw error;
}
