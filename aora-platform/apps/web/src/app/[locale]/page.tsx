import Link from "next/link";
import { notFound } from "next/navigation";

import { hasSupabaseEnvironment } from "@/lib/env";
import { isSupportedLocale } from "@/lib/i18n/config";
import { getMessages } from "@/lib/i18n/messages";

interface LocaleHomePageProps {
  params: Promise<{ locale: string }>;
}

export default async function LocaleHomePage({ params }: LocaleHomePageProps) {
  const { locale } = await params;

  if (!isSupportedLocale(locale)) {
    notFound();
  }

  const messages = getMessages(locale);
  const live = hasSupabaseEnvironment();

  return (
    <div className="page-stack">
      <section className="hero">
        <div>
          <p className="eyebrow">International workforce operations</p>
          <h1>One organization. Every store. The right access.</h1>
          <p>
            Aora separates organization ownership, store management and employee
            self-service while keeping every action auditable and location scoped.
          </p>
        </div>
        <span className="mode-pill">
          {live ? messages.liveMode : messages.previewMode}
        </span>
      </section>

      <section aria-labelledby="workspace-heading" className="page-stack">
        <div className="section-heading">
          <div>
            <h2 id="workspace-heading">Choose a workspace</h2>
            <p>Each role receives a different navigation and permission boundary.</p>
          </div>
        </div>
        <div className="role-grid">
          <Link className="role-card" href={`/${locale}/owner`}>
            <div>
              <p className="eyebrow">Organization</p>
              <h2>{messages.owner}</h2>
              <p>{messages.ownerIntro}</p>
            </div>
            <span className="role-card__action">Open owner workspace →</span>
          </Link>
          <Link className="role-card" href={`/${locale}/manager`}>
            <div>
              <p className="eyebrow">Store</p>
              <h2>{messages.manager}</h2>
              <p>{messages.managerIntro}</p>
            </div>
            <span className="role-card__action">Open manager workspace →</span>
          </Link>
          <Link className="role-card" href={`/${locale}/employee`}>
            <div>
              <p className="eyebrow">Personal</p>
              <h2>{messages.employee}</h2>
              <p>{messages.employeeIntro}</p>
            </div>
            <span className="role-card__action">Open employee workspace →</span>
          </Link>
        </div>
      </section>
    </div>
  );
}
