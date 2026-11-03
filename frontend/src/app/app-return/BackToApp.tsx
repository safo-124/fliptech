"use client";

import { useEffect } from "react";

/** Opens the app at once, with a button for phones that ask first. */
export function BackToApp({ target }: { target: string }) {
  useEffect(() => {
    window.location.replace(target);
  }, [target]);

  return (
    <div className="app-shell mx-auto flex min-h-[50dvh] max-w-md flex-col items-center justify-center gap-4 py-16 text-center">
      <h1 className="text-2xl font-extrabold tracking-[-0.03em] text-[var(--color-brand-deep)]">Payment done</h1>
      <p className="text-sm text-[var(--color-muted-foreground)]">Taking you back to the Fliiptech app…</p>
      <a
        href={target}
        className="inline-flex min-h-12 items-center rounded-full bg-[var(--color-brand)] px-6 text-sm font-bold text-white hover:bg-[var(--color-brand-strong)]"
      >
        Back to the app
      </a>
    </div>
  );
}
