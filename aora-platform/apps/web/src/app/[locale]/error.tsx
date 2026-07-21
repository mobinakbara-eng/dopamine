"use client";

import { useEffect } from "react";

interface LocaleErrorProps {
  error: Error & { digest?: string };
  reset: () => void;
}

export default function LocaleError({ error, reset }: LocaleErrorProps) {
  useEffect(() => {
    console.error("Aora workspace error", {
      message: error.message,
      digest: error.digest,
    });
  }, [error]);

  return (
    <div className="auth-layout">
      <section className="auth-card">
        <p className="eyebrow">Workspace unavailable</p>
        <h1>We could not load this workspace</h1>
        <p>
          Your permission or data scope could not be verified. No mutation was
          performed.
        </p>
        <button className="button button--primary" onClick={reset} type="button">
          Try again
        </button>
      </section>
    </div>
  );
}
