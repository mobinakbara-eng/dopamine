import "server-only";

import { createHash, randomBytes } from "node:crypto";

import type { SupportedLocale } from "@/lib/i18n/config";
import { getServerEnv } from "@/lib/env";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabasePublicServerClient } from "@/lib/supabase/public-server";

export type InvitationRole = "manager" | "employee";

export interface CreateInvitationInput {
  organizationId: string;
  locationId: string;
  employeeId?: string | null;
  email: string;
  displayName: string;
  role: InvitationRole;
  locale: SupportedLocale;
  createdBy: string;
}

export interface CreatedInvitation {
  id: string;
  email: string;
  expiresAt: string;
}

function invitationToken(): string {
  return randomBytes(32).toString("base64url");
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function isExistingUserError(message: string): boolean {
  const normalized = message.toLowerCase();
  return (
    normalized.includes("already") ||
    normalized.includes("registered") ||
    normalized.includes("exists")
  );
}

export async function createAndSendInvitation(
  input: CreateInvitationInput,
): Promise<CreatedInvitation> {
  const env = getServerEnv();
  const admin = createSupabaseAdminClient();
  const token = invitationToken();
  const tokenHash = hashToken(token);
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  const redirectUrl = new URL(`/${input.locale}/invite/accept`, env.NEXT_PUBLIC_APP_URL);
  redirectUrl.searchParams.set("token", token);

  const { data: invitation, error: insertError } = await admin
    .from("member_invitations")
    .insert({
      organization_id: input.organizationId,
      location_id: input.locationId,
      employee_id: input.employeeId ?? null,
      email: input.email,
      display_name: input.displayName,
      role: input.role,
      token_hash: tokenHash,
      status: "pending",
      created_by: input.createdBy,
      expires_at: expiresAt,
    })
    .select("id, email, expires_at")
    .single();

  if (insertError || !invitation) {
    if (insertError?.code === "23505") {
      throw new Error("A pending invitation already exists for this email and store.");
    }

    throw new Error(insertError?.message ?? "The invitation could not be created.");
  }

  const inviteMetadata = {
    invitation_id: invitation.id,
    organization_id: input.organizationId,
    location_id: input.locationId,
    requested_role: input.role,
    display_name: input.displayName,
    locale: input.locale,
  };

  const { error: inviteError } = await admin.auth.admin.inviteUserByEmail(
    input.email,
    {
      data: inviteMetadata,
      redirectTo: redirectUrl.toString(),
    },
  );

  let finalError = inviteError;

  if (inviteError && isExistingUserError(inviteError.message)) {
    const publicClient = createSupabasePublicServerClient();
    const { error: magicLinkError } = await publicClient.auth.signInWithOtp({
      email: input.email,
      options: {
        shouldCreateUser: false,
        emailRedirectTo: redirectUrl.toString(),
        data: inviteMetadata,
      },
    });
    finalError = magicLinkError;
  }

  if (finalError) {
    await admin
      .from("member_invitations")
      .update({
        status: "revoked",
        revoked_at: new Date().toISOString(),
        revoke_reason: "email_delivery_failed",
      })
      .eq("id", invitation.id)
      .eq("status", "pending");

    throw new Error("The invitation email could not be delivered.");
  }

  return {
    id: String(invitation.id),
    email: String(invitation.email),
    expiresAt: String(invitation.expires_at),
  };
}
