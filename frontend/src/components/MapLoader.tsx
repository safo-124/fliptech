"use client";

/**
 * Client boundary for the map.
 *
 * `ssr: false` is not allowed in a Server Component under the App Router, so
 * the dynamic import lives here instead. The page stays a Server Component and
 * still fetches the providers server-side — only Leaflet itself is deferred to
 * the browser, which is the part that touches `window` at import time.
 */

import dynamic from "next/dynamic";
import Link from "next/link";
import { Component, type ErrorInfo, type ReactNode } from "react";

import type { ProviderCard } from "@/lib/types";

function MapLoadingState() {
  return (
    <div
      className="grid h-[70dvh] place-items-center bg-[var(--color-muted)]/35 px-6 text-center"
      role="status"
      aria-live="polite"
      aria-busy="true"
    >
      <div>
        <span
          className="mx-auto grid size-10 place-items-center rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] text-[var(--color-muted-foreground)] shadow-xs"
          aria-hidden="true"
        >
          <svg viewBox="0 0 24 24" className="size-5 fill-none stroke-current stroke-[1.8]">
            <path d="m9 18-6 3V6l6-3 6 3 6-3v15l-6 3-6-3Z" />
            <path d="M9 3v15M15 6v15" />
          </svg>
        </span>
        <p className="mt-3 text-sm font-medium text-[var(--color-foreground)]">Loading map</p>
        <p className="mt-1 text-xs text-[var(--color-muted-foreground)]">
          Preparing provider locations…
        </p>
      </div>
    </div>
  );
}

const MapView = dynamic(() => import("./MapView"), {
  ssr: false,
  loading: MapLoadingState,
});

class MapErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Keep the public fallback useful while still leaving diagnostics for the
    // browser error collector in production.
    console.error("The provider map failed to initialise", error, info);
  }

  render() {
    if (this.state.failed) {
      return (
        <div className="grid h-[70dvh] place-items-center bg-[var(--color-muted)]/35 px-6 text-center" role="alert">
          <div className="max-w-sm">
            <h2 className="text-base font-semibold">The interactive map could not start</h2>
            <p className="mt-2 text-sm leading-6 text-[var(--color-muted-foreground)]">
              Provider details are safe. Reload the page to try the map again, or use the list
              view to keep browsing.
            </p>
            <div className="mt-4 flex flex-wrap justify-center gap-3">
              <button
                type="button"
                className="tap rounded-md bg-[var(--color-primary)] px-4 text-sm text-[var(--color-primary-foreground)]"
                onClick={() => window.location.reload()}
              >
                Reload map
              </button>
              <Link
                href="/"
                className="tap rounded-md border border-[var(--color-border)] px-4 text-sm"
              >
                Use list view
              </Link>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export function MapLoader({ providers }: { providers: ProviderCard[] }) {
  // Avoid downloading Leaflet's client chunk when there is nothing to plot.
  if (providers.length === 0) {
    return (
      <div className="grid h-[70dvh] place-items-center bg-[var(--color-muted)]/35 px-6 text-center" role="status">
        <div className="max-w-sm">
          <h2 className="text-base font-semibold">No provider locations to map</h2>
          <p className="mt-2 text-sm text-[var(--color-muted-foreground)]">
            Try the list view while provider locations are being added.
          </p>
        </div>
      </div>
    );
  }

  return (
    <MapErrorBoundary>
      <MapView providers={providers} />
    </MapErrorBoundary>
  );
}
