export default function LocaleLoading() {
  return (
    <div aria-busy="true" aria-live="polite" className="page-stack" role="status">
      <section className="hero">
        <div>
          <p className="eyebrow">Aora Workforce</p>
          <h1>Loading workspace</h1>
          <p>Your organization and permission scope are being verified.</p>
        </div>
        <span className="mode-pill">Loading</span>
      </section>
      <span className="sr-only">Loading workspace data.</span>
    </div>
  );
}
