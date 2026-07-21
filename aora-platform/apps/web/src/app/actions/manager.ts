"use server";

import { randomUUID } from "node:crypto";

import { revalidatePath } from "next/cache";

import { actionFailure, textField } from "@/lib/actions/helpers";
import { requireStoreManager } from "@/lib/auth/permissions";
import type { ActionState } from "@/lib/domain/action-state";
import { inviteEmployeeSchema } from "@/lib/domain/schemas";
import { createAndSendInvitation } from "@/lib/invitations/service";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function inviteEmployeeAction(
  _previousState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  let employeeId: string | null = null;

  try {
    const input = inviteEmployeeSchema.parse({
      organizationId: textField(formData, "organizationId"),
      locationId: textField(formData, "locationId"),
      email: textField(formData, "email"),
      displayName: textField(formData, "displayName"),
      title: textField(formData, "title"),
      locale: textField(formData, "locale"),
    });
    const membership = await requireStoreManager(
      input.organizationId,
      input.locationId,
    );
    const supabase = await createSupabaseServerClient();
    employeeId = `emp_${randomUUID()}`;

    const { error: employeeError } = await supabase.from("employees").insert({
      id: employeeId,
      organization_id: membership.organizationId,
      location_id: input.locationId,
      name: input.displayName,
      email: input.email,
      role: input.title,
      active: false,
      payload: {
        title: input.title,
        onboardingStatus: "invited",
        invitedBy: membership.userId,
      },
    });

    if (employeeError) {
      if (employeeError.code === "23505") {
        throw new Error("An employee with this email already exists in the store.");
      }

      throw new Error(employeeError.message);
    }

    await createAndSendInvitation({
      organizationId: membership.organizationId,
      locationId: input.locationId,
      employeeId,
      email: input.email,
      displayName: input.displayName,
      role: "employee",
      locale: input.locale,
      createdBy: membership.userId,
    });

    revalidatePath(`/${input.locale}/manager`);

    return {
      status: "success",
      message: `An employee account invitation was sent to ${input.email}.`,
    };
  } catch (error) {
    if (employeeId) {
      try {
        const supabase = await createSupabaseServerClient();
        await supabase
          .from("employees")
          .delete()
          .eq("id", employeeId)
          .eq("active", false);
      } catch {
        // The invitation record remains auditable. Operations can reconcile this row.
      }
    }

    return actionFailure(error);
  }
}
