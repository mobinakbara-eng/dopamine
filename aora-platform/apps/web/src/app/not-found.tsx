import Link from "next/link";

export default function NotFoundPage() {
  return (
    <div className="auth-layout">
      <section className="auth-card">
        <p className="eyebrow">404</p>
        <h1>Page not found</h1>
        <p>
          This workspace or language route does not exist. No data was changed.
        </p>
        <Link className="button button--primary" href="/de">
          Return to Aora
        </Link>
      </section>
    </div>
  );
}
