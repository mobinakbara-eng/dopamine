import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { AcceptInvitationForm } from "@/components/forms/accept-invitation-form";
import { hasSupabaseEnvironment } from "@/lib/env";
import { isSupportedLocale } from "@/lib/i18n/config";
import { getMessages } from "@/lib/i18n/messages";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Accept invitation",
};

interface AcceptInvitationPageProps {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ token?: string }>;
}

export default async function AcceptInvitationPage({
  params,
  searchParams,
}: AcceptInvitationPageProps) {
  const [{ locale }, query] = await Promise.all([params, searchParams]);

  if (!isSupportedLocale(locale)) {
    notFound();
  }

  const messages = getMessages(locale);
  const token = query.token ?? "";

  return (
    <div className="auth-layout">
      <section className="auth-card">
        <p className="eyebrow">Membership</p>
        <h1>{messages.acceptInvitation}</h1>
        <p>
          Aora verifies the signed-in email, invitation status, expiration, store
          scope and requested role before activating access.
        </p>
        {token ? (
          <AcceptInvitationForm
            enabled={hasSupabaseEnvironment()}
            locale={locale}
            token={token}
          />
        ) : (
          <p className="form-message" data-status="error" role="alert">
            This invitation link is incomplete.
          </p>
        )}
      </section>
    </div>
  );
}
