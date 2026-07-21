import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { CreateStoreForm } from "@/components/forms/create-store-form";
import { InviteManagerForm } from "@/components/forms/invite-manager-form";
import { MetricCard } from "@/components/metric-card";
import { StatusBadge } from "@/components/status-badge";
import { isSupportedLocale } from "@/lib/i18n/config";
import { getMessages } from "@/lib/i18n/messages";
import { loadOwnerDashboard } from "@/lib/repositories/dashboard";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Owner workspace",
};

interface OwnerPageProps {
  params: Promise<{ locale: string }>;
}

export default async function OwnerPage({ params }: OwnerPageProps) {
  const { locale } = await params;

  if (!isSupportedLocale(locale)) {
    notFound();
  }

  const messages = getMessages(locale);
  const dashboard = await loadOwnerDashboard();
  const enabled = dashboard.mode === "live";
  const activeManagers = dashboard.managers.filter(
    (manager) => manager.status === "active",
  ).length;
  const employeeCount = dashboard.stores.reduce(
    (sum, store) => sum + store.employeeCount,
    0,
  );

  return (
    <div className="page-stack">
      <section className="hero">
        <div>
          <p className="eyebrow">{dashboard.organizationName}</p>
          <h1>{messages.owner}</h1>
          <p>{messages.ownerIntro}</p>
        </div>
        <span className="mode-pill">
          {enabled ? messages.liveMode : messages.previewMode}
        </span>
      </section>

      <section aria-label="Organization summary" className="metrics-grid">
        <MetricCard label={messages.stores} value={dashboard.stores.length} />
        <MetricCard label={messages.managers} value={activeManagers} />
        <MetricCard label={messages.employees} value={employeeCount} />
        <MetricCard
          label={messages.invitations}
          value={dashboard.invitations.length}
        />
      </section>

      <div className="two-column">
        <section aria-labelledby="stores-heading" className="panel">
          <div className="panel__header">
            <div>
              <h2 id="stores-heading">{messages.stores}</h2>
              <p>Every manager and employee is scoped to one of these locations.</p>
            </div>
          </div>
          <div className="panel__body">
            {dashboard.stores.length ? (
              <ul className="card-list">
                {dashboard.stores.map((store) => (
                  <li className="list-card" key={store.id}>
                    <div>
                      <h3>{store.name}</h3>
                      <p>
                        {store.city} · {store.timezone} · {store.managerCount} manager ·{" "}
                        {store.employeeCount} employees
                      </p>
                    </div>
                    <StatusBadge
                      label={store.status}
                      tone={store.status === "active" ? "success" : "neutral"}
                    />
                  </li>
                ))}
              </ul>
            ) : (
              <p className="empty-state">{messages.noData}</p>
            )}
          </div>
        </section>

        <section aria-labelledby="create-store-heading" className="panel">
          <div className="panel__header">
            <div>
              <h2 id="create-store-heading">{messages.createStore}</h2>
              <p>Create the location before assigning its manager.</p>
            </div>
          </div>
          <div className="panel__body">
            <CreateStoreForm
              enabled={enabled}
              locale={locale}
              organizationId={dashboard.organizationId}
            />
          </div>
        </section>
      </div>

      <div className="two-column">
        <section aria-labelledby="manager-heading" className="panel">
          <div className="panel__header">
            <div>
              <h2 id="manager-heading">{messages.managers}</h2>
              <p>Owner can assign and audit manager access per store.</p>
            </div>
          </div>
          <div className="panel__body">
            {dashboard.managers.length ? (
              <ul className="card-list">
                {dashboard.managers.map((manager) => (
                  <li className="list-card" key={manager.membershipId}>
                    <div>
                      <h3>{manager.displayName}</h3>
                      <p>
                        {manager.email} · {manager.locationName}
                      </p>
                    </div>
                    <StatusBadge
                      label={manager.status}
                      tone={
                        manager.status === "active" ? "success" : "warning"
                      }
                    />
                  </li>
                ))}
              </ul>
            ) : (
              <p className="empty-state">{messages.noData}</p>
            )}
          </div>
        </section>

        <section aria-labelledby="invite-manager-heading" className="panel">
          <div className="panel__header">
            <div>
              <h2 id="invite-manager-heading">{messages.inviteManager}</h2>
              <p>The email invitation activates only the selected store scope.</p>
            </div>
          </div>
          <div className="panel__body">
            <InviteManagerForm
              enabled={enabled}
              locale={locale}
              organizationId={dashboard.organizationId}
              stores={dashboard.stores}
            />
          </div>
        </section>
      </div>

      <section aria-labelledby="owner-invitations-heading" className="panel">
        <div className="panel__header">
          <div>
            <h2 id="owner-invitations-heading">{messages.invitations}</h2>
            <p>Pending invitations remain revocable and expire automatically.</p>
          </div>
        </div>
        <div className="panel__body">
          {dashboard.invitations.length ? (
            <ul className="card-list">
              {dashboard.invitations.map((invitation) => (
                <li className="list-card" key={invitation.id}>
                  <div>
                    <h3>{invitation.email}</h3>
                    <p>
                      {invitation.locationName ?? "Organization"} · expires{" "}
                      {new Intl.DateTimeFormat(locale, {
                        dateStyle: "medium",
                      }).format(new Date(invitation.expiresAt))}
                    </p>
                  </div>
                  <StatusBadge label={invitation.status} tone="warning" />
                </li>
              ))}
            </ul>
          ) : (
            <p className="empty-state">{messages.noData}</p>
          )}
        </div>
      </section>
    </div>
  );
}
