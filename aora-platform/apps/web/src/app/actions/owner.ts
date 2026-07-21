"use server";

import { randomUUID } from "node:crypto";

import { revalidatePath } from "next/cache";

import { actionFailure, textField } from "@/lib/actions/helpers";
import { requireOwner } from "@/lib/auth/permissions";
import type { ActionState } from "@/lib/domain/action-state";
import {
  createStoreSchema,
  inviteManagerSchema,
} from "@/lib/domain/schemas";
import { createAndSendInvitation } from "@/lib/invitations/service";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function createStoreAction(
  _previousState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const input = createStoreSchema.parse({
      organizationId: textField(formData, "organizationId"),
      name: textField(formData, "name"),
      slug: textField(formData, "slug"),
      city: textField(formData, "city"),
      postalCode: textField(formData, "postalCode"),
      addressLine: textField(formData, "addressLine"),
      countryCode: textField(formData, "countryCode"),
      timezone: textField(formData, "timezone"),
      locale: textField(formData, "locale"),
    });
    const membership = await requireOwner(input.organizationId);
    const supabase = await createSupabaseServerClient();
    const locationId = `loc_${randomUUID()}`;

    const { error } = await supabase.from("locations").insert({
      id: locationId,
      organization_id: membership.organizationId,
      name: input.name,
      slug: input.slug,
      city: input.city,
      postal_code: input.postalCode,
      address_line: input.addressLine,
      country_code: input.countryCode,
      timezone: input.timezone,
      locale: input.locale,
      status: "active",
      active: true,
      payload: {
        slug: input.slug,
        postalCode: input.postalCode,
        addressLine: input.addressLine,
        countryCode: input.countryCode,
        timezone: input.timezone,
        locale: input.locale,
        createdBy: membership.userId,
      },
    });

    if (error) {
      if (error.code === "23505") {
        throw new Error("This store slug is already used in the organization.");
      }

      throw new Error(error.message);
    }

    revalidatePath(`/${input.locale}/owner`);

    return {
      status: "success",
      message: `${input.name} was created successfully.`,
    };
  } catch (error) {
    return actionFailure(error);
  }
}

export async function inviteManagerAction(
  _previousState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const input = inviteManagerSchema.parse({
      organizationId: textField(formData, "organizationId"),
      locationId: textField(formData, "locationId"),
      email: textField(formData, "email"),
      displayName: textField(formData, "displayName"),
      locale: textField(formData, "locale"),
    });
    const membership = await requireOwner(input.organizationId);
    const supabase = await createSupabaseServerClient();
    const { data: store, error: storeError } = await supabase
      .from("locations")
      .select("id")
      .eq("organization_id", membership.organizationId)
      .eq("id", input.locationId)
      .eq("active", true)
      .maybeSingle();

    if (storeError || !store) {
      throw new Error("The selected store is not available in your organization.");
    }

    await createAndSendInvitation({
      organizationId: membership.organizationId,
      locationId: input.locationId,
      email: input.email,
      displayName: input.displayName,
      role: "manager",
      locale: input.locale,
      createdBy: membership.userId,
    });

    revalidatePath(`/${input.locale}/owner`);

    return {
      status: "success",
      message: `An invitation was sent to ${input.email}.`,
    };
  } catch (error) {
    return actionFailure(error);
  }
}
