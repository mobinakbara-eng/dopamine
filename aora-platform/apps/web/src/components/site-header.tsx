import Link from "next/link";

import type { SupportedLocale } from "@/lib/i18n/config";
import { getMessages } from "@/lib/i18n/messages";

interface SiteHeaderProps {
  locale: SupportedLocale;
}

export function SiteHeader({ locale }: SiteHeaderProps) {
  const messages = getMessages(locale);

  return (
    <header className="site-header">
      <div className="site-header__inner">
        <Link className="brand" href={`/${locale}`}>
          <span aria-hidden="true" className="brand__mark">
            AO
          </span>
          <span>{messages.appName}</span>
        </Link>
        <nav aria-label="Primary navigation" className="primary-nav">
          <Link href={`/${locale}/owner`}>{messages.owner}</Link>
          <Link href={`/${locale}/manager`}>{messages.manager}</Link>
          <Link href={`/${locale}/employee`}>{messages.employee}</Link>
          <Link href={`/${locale}/login`}>{messages.email}</Link>
        </nav>
      </div>
    </header>
  );
}
