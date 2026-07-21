"use client";

import { useActionState } from "react";

import { createStoreAction } from "@/app/actions/owner";
import { FormMessage } from "@/components/forms/form-message";
import { SubmitButton } from "@/components/forms/submit-button";
import { initialActionState } from "@/lib/domain/action-state";
import type { SupportedLocale } from "@/lib/i18n/config";
import { getMessages } from "@/lib/i18n/messages";

interface CreateStoreFormProps {
  organizationId: string;
  locale: SupportedLocale;
  enabled: boolean;
}

function errorFor(
  errors: Record<string, string[]> | undefined,
  field: string,
): string | undefined {
  return errors?.[field]?.[0];
}

export function CreateStoreForm({
  organizationId,
  locale,
  enabled,
}: CreateStoreFormProps) {
  const messages = getMessages(locale);
  const [state, formAction] = useActionState(
    createStoreAction,
    initialActionState,
  );

  return (
    <form action={formAction} className="form-grid">
      <input name="organizationId" type="hidden" value={organizationId} />
      <input name="locale" type="hidden" value={locale} />
      <div className="form-row">
        <div className="field">
          <label htmlFor="store-name">{messages.storeName}</label>
          <input
            aria-describedby="store-name-error"
            autoComplete="organization"
            disabled={!enabled}
            id="store-name"
            name="name"
            required
          />
          {errorFor(state.fieldErrors, "name") ? (
            <p className="field__error" id="store-name-error">
              {errorFor(state.fieldErrors, "name")}
            </p>
          ) : null}
        </div>
        <div className="field">
          <label htmlFor="store-slug">{messages.storeSlug}</label>
          <input
            aria-describedby="store-slug-hint store-slug-error"
            autoCapitalize="none"
            autoComplete="off"
            disabled={!enabled}
            id="store-slug"
            name="slug"
            pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
            required
          />
          <p className="field__hint" id="store-slug-hint">
            berlin-mitte
          </p>
          {errorFor(state.fieldErrors, "slug") ? (
            <p className="field__error" id="store-slug-error">
              {errorFor(state.fieldErrors, "slug")}
            </p>
          ) : null}
        </div>
      </div>
      <div className="form-row">
        <div className="field">
          <label htmlFor="store-address">{messages.address}</label>
          <input
            autoComplete="street-address"
            disabled={!enabled}
            id="store-address"
            name="addressLine"
            required
          />
        </div>
        <div className="field">
          <label htmlFor="store-postal-code">{messages.postalCode}</label>
          <input
            autoComplete="postal-code"
            disabled={!enabled}
            id="store-postal-code"
            name="postalCode"
            required
          />
        </div>
      </div>
      <div className="form-row">
        <div className="field">
          <label htmlFor="store-city">{messages.city}</label>
          <input
            autoComplete="address-level2"
            disabled={!enabled}
            id="store-city"
            name="city"
            required
          />
        </div>
        <div className="field">
          <label htmlFor="store-country">{messages.country}</label>
          <input
            autoComplete="country"
            defaultValue="DE"
            disabled={!enabled}
            id="store-country"
            maxLength={2}
            name="countryCode"
            required
          />
        </div>
      </div>
      <div className="field">
        <label htmlFor="store-timezone">{messages.timezone}</label>
        <select
          defaultValue="Europe/Berlin"
          disabled={!enabled}
          id="store-timezone"
          name="timezone"
          required
        >
          <option value="Europe/Berlin">Europe/Berlin</option>
          <option value="Europe/London">Europe/London</option>
          <option value="Europe/Istanbul">Europe/Istanbul</option>
          <option value="Asia/Tehran">Asia/Tehran</option>
        </select>
      </div>
      <FormMessage state={state} />
      <SubmitButton
        idleLabel={messages.createStore}
        pendingLabel={`${messages.createStore}…`}
      />
      {!enabled ? (
        <p className="field__hint">
          Connect an isolated Supabase environment to enable write actions.
        </p>
      ) : null}
    </form>
  );
}
