import { notFound } from "next/navigation";

import { SiteHeader } from "@/components/site-header";
import {
  getTextDirection,
  isSupportedLocale,
  type SupportedLocale,
} from "@/lib/i18n/config";

interface LocaleLayoutProps {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}

export default async function LocaleLayout({
  children,
  params,
}: LocaleLayoutProps) {
  const { locale: requestedLocale } = await params;

  if (!isSupportedLocale(requestedLocale)) {
    notFound();
  }

  const locale: SupportedLocale = requestedLocale;

  return (
    <div
      className="app-shell"
      dir={getTextDirection(locale)}
      lang={locale}
    >
      <SiteHeader locale={locale} />
      <main className="main-content" id="main-content">
        {children}
      </main>
    </div>
  );
}
