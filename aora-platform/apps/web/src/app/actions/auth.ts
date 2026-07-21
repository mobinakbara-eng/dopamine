"use server";

import { actionFailure, textField } from "@/lib/actions/helpers";
import type { ActionState } from "@/lib/domain/action-state";
import { getPublicEnv } from "@/lib/env";
import { isSupportedLocale } from "@/lib/i18n/config";
import { createSupabasePublicServerClient } from "@/lib/supabase/public-server";

export async function requestSignInLinkAction(
  _previousState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const email = textField(formData, "email").trim().toLowerCase();
    const requestedLocale = textField(formData, "locale");
    const locale = isSupportedLocale(requestedLocale) ? requestedLocale : "de";

    if (!/^\S+@\S+\.\S+$/.test(email) || email.length > 254) {
      return {
        status: "error",
        message: "Enter a valid email address.",
        fieldErrors: { email: ["Enter a valid email address."] },
      };
    }

    const env = getPublicEnv();
    const callback = new URL("/auth/confirm", env.NEXT_PUBLIC_APP_URL);
    callback.searchParams.set("next", `/${locale}`);
    const supabase = createSupabasePublicServerClient();
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        shouldCreateUser: false,
        emailRedirectTo: callback.toString(),
      },
    });

    if (error) {
      throw new Error("A sign-in link could not be sent for this account.");
    }

    return {
      status: "success",
      message: "Check your email for a secure sign-in link.",
    };
  } catch (error) {
    return actionFailure(error);
  }
}
