import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { SignInForm } from "@/components/forms/sign-in-form";
import { hasSupabaseEnvironment } from "@/lib/env";
import { isSupportedLocale } from "@/lib/i18n/config";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Sign in",
};

interface LoginPageProps {
  params: Promise<{ locale: string }>;
}

export default async function LoginPage({ params }: LoginPageProps) {
  const { locale } = await params;

  if (!isSupportedLocale(locale)) {
    notFound();
  }

  return (
    <div className="auth-layout">
      <section className="auth-card">
        <p className="eyebrow">Secure access</p>
        <h1>Sign in to Aora</h1>
        <p>
          Aora sends a one-time link to the email associated with your organization
          membership. Accounts cannot be created from this public form.
        </p>
        <SignInForm enabled={hasSupabaseEnvironment()} locale={locale} />
      </section>
    </div>
  );
}
