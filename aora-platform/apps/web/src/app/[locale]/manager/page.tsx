import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { InviteEmployeeForm } from "@/components/forms/invite-employee-form";
import { MetricCard } from "@/components/metric-card";
import { StatusBadge } from "@/components/status-badge";
import { isSupportedLocale } from "@/lib/i18n/config";
import { getMessages } from "@/lib/i18n/messages";
import { loadManagerDashboard } from "@/lib/repositories/dashboard";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Manager workspace",
};

interface ManagerPageProps {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ store?: string }>;
}

export default async function ManagerPage({
  params,
  searchParams,
}: ManagerPageProps) {
  const [{ locale }, query] = await Promise.all([params, searchParams]);

  if (!isSupportedLocale(locale)) {
    notFound();
  }

  const messages = getMessages(locale);
  const dashboard = await loadManagerDashboard(query.store);
  const enabled = dashboard.mode === "live";
  const activeEmployees = dashboard.employees.filter(
    (employee) => employee.status === "active",
  ).length;

  return (
    <div className="page-stack">
      <section className="hero">
        <div>
          <p className="eyebrow">{dashboard.organizationName}</p>
          <h1>{dashboard.selectedStore.name}</h1>
          <p>{messages.managerIntro}</p>
        </div>
        <span className="mode-pill">
          {enabled ? messages.liveMode : messages.previewMode}
        </span>
      </section>

      {dashboard.availableStores.length > 1 ? (
        <nav aria-label="Assigned stores" className="primary-nav">
          {dashboard.availableStores.map((store) => (
            <Link
              href={`/${locale}/manager?store=${encodeURIComponent(store.id)}`}
              key={store.id}
            >
              {store.name}
            </Link>
          ))}
        </nav>
      ) : null}

      <section aria-label="Store summary" className="metrics-grid">
        <MetricCard label={messages.employees} value={activeEmployees} />
        <MetricCard
          label={messages.invitations}
          value={dashboard.invitations.length}
        />
        <MetricCard label="Store timezone" value={dashboard.selectedStore.timezone} />
        <MetricCard label="Store status" value={dashboard.selectedStore.status} />
      </section>

      <div className="two-column">
        <section aria-labelledby="employees-heading" className="panel">
          <div className="panel__header">
            <div>
              <h2 id="employees-heading">{messages.employees}</h2>
              <p>
                This list contains only employees linked to the selected store.
              </p>
            </div>
          </div>
          <div className="panel__body">
            {dashboard.employees.length ? (
              <ul className="card-list">
                {dashboard.employees.map((employee) => (
                  <li className="list-card" key={employee.id}>
                    <div>
                      <h3>{employee.name}</h3>
                      <p>
                        {employee.email} · {employee.title}
                      </p>
                    </div>
                    <StatusBadge
                      label={employee.status}
                      tone={
                        employee.status === "active" ? "success" : "warning"
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

        <section aria-labelledby="invite-employee-heading" className="panel">
          <div className="panel__header">
            <div>
              <h2 id="invite-employee-heading">{messages.inviteEmployee}</h2>
              <p>
                The new employee profile and account stay inside this store scope.
              </p>
            </div>
          </div>
          <div className="panel__body">
            <InviteEmployeeForm
              enabled={enabled}
              locale={locale}
              locationId={dashboard.selectedStore.id}
              organizationId={dashboard.organizationId}
            />
          </div>
        </section>
      </div>

      <section aria-labelledby="manager-invitations-heading" className="panel">
        <div className="panel__header">
          <div>
            <h2 id="manager-invitations-heading">{messages.invitations}</h2>
            <p>Track onboarding without granting access before email acceptance.</p>
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
                      {invitation.locationName} · expires{" "}
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
