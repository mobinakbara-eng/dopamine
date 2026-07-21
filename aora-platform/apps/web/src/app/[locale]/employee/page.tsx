import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { MetricCard } from "@/components/metric-card";
import { StatusBadge } from "@/components/status-badge";
import { isSupportedLocale } from "@/lib/i18n/config";
import { getMessages } from "@/lib/i18n/messages";
import { loadEmployeeDashboard } from "@/lib/repositories/dashboard";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Employee workspace",
};

interface EmployeePageProps {
  params: Promise<{ locale: string }>;
}

export default async function EmployeePage({ params }: EmployeePageProps) {
  const { locale } = await params;

  if (!isSupportedLocale(locale)) {
    notFound();
  }

  const messages = getMessages(locale);
  const dashboard = await loadEmployeeDashboard();
  const clockTone = dashboard.clockState === "working" ? "success" : "neutral";

  return (
    <div className="page-stack">
      <section className="hero">
        <div>
          <p className="eyebrow">{dashboard.storeName}</p>
          <h1>{dashboard.employeeName}</h1>
          <p>{messages.employeeIntro}</p>
        </div>
        <span className="mode-pill">
          {dashboard.mode === "live" ? messages.liveMode : messages.previewMode}
        </span>
      </section>

      <section aria-label="Today summary" className="metrics-grid">
        <MetricCard label="Next shift" value={dashboard.nextShift} />
        <MetricCard label="Open tasks" value={dashboard.openTaskCount} />
        <MetricCard label="Unread notices" value={dashboard.unreadNoticeCount} />
        <MetricCard label="Clock state" value={dashboard.clockState} />
      </section>

      <div className="two-column">
        <section aria-labelledby="today-heading" className="panel">
          <div className="panel__header">
            <div>
              <h2 id="today-heading">Today</h2>
              <p>Your next action and current attendance status.</p>
            </div>
            <StatusBadge label={dashboard.clockState} tone={clockTone} />
          </div>
          <div className="panel__body page-stack">
            <article className="list-card">
              <div>
                <h3>{dashboard.nextShift}</h3>
                <p>{dashboard.storeName}</p>
              </div>
              <button className="button button--primary" disabled type="button">
                Clock flow connects in the attendance migration slice
              </button>
            </article>
            <p className="field__hint">
              The employee page deliberately exposes no organization-wide manager or
              payroll administration controls.
            </p>
          </div>
        </section>

        <section aria-labelledby="employee-boundary-heading" className="panel">
          <div className="panel__header">
            <div>
              <h2 id="employee-boundary-heading">Access boundary</h2>
              <p>Personal and explicitly shared store data only.</p>
            </div>
          </div>
          <div className="panel__body">
            <ul className="card-list">
              <li className="list-card">
                <div>
                  <h3>Personal schedule</h3>
                  <p>Own shifts, confirmations and open shift requests.</p>
                </div>
                <StatusBadge label="allowed" tone="success" />
              </li>
              <li className="list-card">
                <div>
                  <h3>Own time and leave</h3>
                  <p>Review records and submit corrections or requests.</p>
                </div>
                <StatusBadge label="allowed" tone="success" />
              </li>
              <li className="list-card">
                <div>
                  <h3>Other employee private data</h3>
                  <p>Time, leave, pay and contract details remain hidden.</p>
                </div>
                <StatusBadge label="denied" tone="neutral" />
              </li>
            </ul>
          </div>
        </section>
      </div>
    </div>
  );
}
