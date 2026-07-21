"use server";

import { revalidatePath } from "next/cache";

import { actionFailure, textField } from "@/lib/actions/helpers";
import type { ActionState } from "@/lib/domain/action-state";
import { acceptInvitationSchema } from "@/lib/domain/schemas";
import { createSupabaseServerClient } from "@/lib/supabase/server";

interface InvitationAcceptanceResult {
  role: "owner" | "manager" | "employee";
  organization_id: string;
  location_id: string | null;
}

export async function acceptInvitationAction(
  _previousState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const input = acceptInvitationSchema.parse({
      token: textField(formData, "token"),
      locale: textField(formData, "locale"),
    });
    const supabase = await createSupabaseServerClient();
    const { data: claimsData, error: claimsError } = await supabase.auth.getClaims();

    if (claimsError || !claimsData?.claims?.sub) {
      throw new Error("Please open the invitation link and sign in with the invited email.");
    }

    const { data, error } = await supabase.rpc("accept_member_invitation", {
      p_token: input.token,
    });

    if (error) {
      throw new Error(error.message);
    }

    const result = Array.isArray(data)
      ? (data[0] as InvitationAcceptanceResult | undefined)
      : (data as InvitationAcceptanceResult | null);

    if (!result?.role) {
      throw new Error("The invitation could not be accepted.");
    }

    revalidatePath(`/${input.locale}`, "layout");

    return {
      status: "success",
      message:
        result.role === "manager"
          ? "Your manager access is active. You can now open the manager workspace."
          : "Your employee account is active. You can now open your workspace.",
    };
  } catch (error) {
    return actionFailure(error);
  }
}
