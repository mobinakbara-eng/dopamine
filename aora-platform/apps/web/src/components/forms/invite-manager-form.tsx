"use client";

import { useActionState } from "react";

import { inviteManagerAction } from "@/app/actions/owner";
import { FormMessage } from "@/components/forms/form-message";
import { SubmitButton } from "@/components/forms/submit-button";
import { initialActionState } from "@/lib/domain/action-state";
import type { StoreSummary } from "@/lib/domain/types";
import type { SupportedLocale } from "@/lib/i18n/config";
import { getMessages } from "@/lib/i18n/messages";

interface InviteManagerFormProps {
  organizationId: string;
  stores: StoreSummary[];
  locale: SupportedLocale;
  enabled: boolean;
}

export function InviteManagerForm({
  organizationId,
  stores,
  locale,
  enabled,
}: InviteManagerFormProps) {
  const messages = getMessages(locale);
  const [state, formAction] = useActionState(
    inviteManagerAction,
    initialActionState,
  );
  const canSubmit = enabled && stores.length > 0;

  return (
    <form action={formAction} className="form-grid">
      <input name="organizationId" type="hidden" value={organizationId} />
      <input name="locale" type="hidden" value={locale} />
      <div className="field">
        <label htmlFor="manager-name">{messages.fullName}</label>
        <input
          autoComplete="name"
          disabled={!canSubmit}
          id="manager-name"
          name="displayName"
          required
        />
      </div>
      <div className="field">
        <label htmlFor="manager-email">{messages.email}</label>
        <input
          autoCapitalize="none"
          autoComplete="email"
          disabled={!canSubmit}
          id="manager-email"
          name="email"
          required
          type="email"
        />
      </div>
      <div className="field">
        <label htmlFor="manager-store">{messages.stores}</label>
        <select
          disabled={!canSubmit}
          id="manager-store"
          name="locationId"
          required
        >
          <option value="">—</option>
          {stores.map((store) => (
            <option key={store.id} value={store.id}>
              {store.name} · {store.city}
            </option>
          ))}
        </select>
      </div>
      <FormMessage state={state} />
      <SubmitButton
        idleLabel={messages.sendInvitation}
        pendingLabel={`${messages.sendInvitation}…`}
      />
      {!enabled ? (
        <p className="field__hint">
          Email invitations are disabled in the safe preview environment.
        </p>
      ) : null}
      {stores.length === 0 ? (
        <p className="field__hint">
          Create a store before inviting its manager.
        </p>
      ) : null}
    </form>
  );
}
