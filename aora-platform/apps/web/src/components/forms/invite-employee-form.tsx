"use client";

import { useActionState } from "react";

import { inviteEmployeeAction } from "@/app/actions/manager";
import { FormMessage } from "@/components/forms/form-message";
import { SubmitButton } from "@/components/forms/submit-button";
import { initialActionState } from "@/lib/domain/action-state";
import type { SupportedLocale } from "@/lib/i18n/config";
import { getMessages } from "@/lib/i18n/messages";

interface InviteEmployeeFormProps {
  organizationId: string;
  locationId: string;
  locale: SupportedLocale;
  enabled: boolean;
}

export function InviteEmployeeForm({
  organizationId,
  locationId,
  locale,
  enabled,
}: InviteEmployeeFormProps) {
  const messages = getMessages(locale);
  const [state, formAction] = useActionState(
    inviteEmployeeAction,
    initialActionState,
  );

  return (
    <form action={formAction} className="form-grid">
      <input name="organizationId" type="hidden" value={organizationId} />
      <input name="locationId" type="hidden" value={locationId} />
      <input name="locale" type="hidden" value={locale} />
      <div className="field">
        <label htmlFor="employee-name">{messages.fullName}</label>
        <input
          autoComplete="name"
          disabled={!enabled}
          id="employee-name"
          name="displayName"
          required
        />
      </div>
      <div className="field">
        <label htmlFor="employee-email">{messages.email}</label>
        <input
          autoCapitalize="none"
          autoComplete="email"
          disabled={!enabled}
          id="employee-email"
          name="email"
          required
          type="email"
        />
      </div>
      <div className="field">
        <label htmlFor="employee-title">{messages.jobTitle}</label>
        <input
          disabled={!enabled}
          id="employee-title"
          name="title"
          placeholder="Barista"
          required
        />
      </div>
      <FormMessage state={state} />
      <SubmitButton
        disabled={!enabled}
        idleLabel={messages.sendInvitation}
        pendingLabel={`${messages.sendInvitation}…`}
      />
      {!enabled ? (
        <p className="field__hint">
          Account creation is disabled until the isolated Supabase environment is connected.
        </p>
      ) : null}
    </form>
  );
}
