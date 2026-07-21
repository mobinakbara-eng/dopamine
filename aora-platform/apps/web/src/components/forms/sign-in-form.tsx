"use client";

import { useActionState } from "react";

import { requestSignInLinkAction } from "@/app/actions/auth";
import { FormMessage } from "@/components/forms/form-message";
import { SubmitButton } from "@/components/forms/submit-button";
import { initialActionState } from "@/lib/domain/action-state";
import type { SupportedLocale } from "@/lib/i18n/config";
import { getMessages } from "@/lib/i18n/messages";

interface SignInFormProps {
  locale: SupportedLocale;
  enabled: boolean;
}

export function SignInForm({ locale, enabled }: SignInFormProps) {
  const messages = getMessages(locale);
  const [state, formAction] = useActionState(
    requestSignInLinkAction,
    initialActionState,
  );

  return (
    <form action={formAction} className="form-grid">
      <input name="locale" type="hidden" value={locale} />
      <div className="field">
        <label htmlFor="sign-in-email">{messages.email}</label>
        <input
          aria-describedby="sign-in-email-hint sign-in-email-error"
          autoCapitalize="none"
          autoComplete="email"
          disabled={!enabled}
          id="sign-in-email"
          name="email"
          required
          type="email"
        />
        <p className="field__hint" id="sign-in-email-hint">
          Use the email invited by your owner or manager.
        </p>
        {state.fieldErrors?.email?.[0] ? (
          <p className="field__error" id="sign-in-email-error">
            {state.fieldErrors.email[0]}
          </p>
        ) : null}
      </div>
      <FormMessage state={state} />
      <SubmitButton
        idleLabel="Send secure sign-in link"
        pendingLabel="Sending link…"
      />
      {!enabled ? (
        <p className="field__hint">
          Authentication is disabled in the visual preview.
        </p>
      ) : null}
    </form>
  );
}
