"use client";

import Link from "next/link";
import { useActionState } from "react";

import { acceptInvitationAction } from "@/app/actions/invitations";
import { FormMessage } from "@/components/forms/form-message";
import { SubmitButton } from "@/components/forms/submit-button";
import { initialActionState } from "@/lib/domain/action-state";
import type { SupportedLocale } from "@/lib/i18n/config";
import { getMessages } from "@/lib/i18n/messages";

interface AcceptInvitationFormProps {
  token: string;
  locale: SupportedLocale;
  enabled: boolean;
}

export function AcceptInvitationForm({
  token,
  locale,
  enabled,
}: AcceptInvitationFormProps) {
  const messages = getMessages(locale);
  const [state, formAction] = useActionState(
    acceptInvitationAction,
    initialActionState,
  );

  return (
    <form action={formAction} className="form-grid">
      <input name="token" type="hidden" value={token} />
      <input name="locale" type="hidden" value={locale} />
      <FormMessage state={state} />
      {state.status === "success" ? (
        <div className="inline-actions">
          <Link className="button button--primary" href={`/${locale}/manager`}>
            {messages.manager}
          </Link>
          <Link className="button button--secondary" href={`/${locale}/employee`}>
            {messages.employee}
          </Link>
        </div>
      ) : (
        <SubmitButton
          idleLabel={messages.acceptInvitation}
          pendingLabel={messages.acceptingInvitation}
        />
      )}
      {!enabled ? (
        <p className="field__hint">
          The safe preview shows this flow but does not activate real accounts.
        </p>
      ) : null}
    </form>
  );
}
