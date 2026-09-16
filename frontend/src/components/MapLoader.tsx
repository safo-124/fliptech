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
import { List, MapPinned, RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import type { ProviderCard } from "@/lib/types";

/**
 * Placeholder sizing.
 *
 * `fill` makes the loading, error and empty states match a parent that has
 * already decided the height — the full-screen map on a phone. Without it they
 * kept their own 70dvh and the screen visibly jumped when the map arrived.
 */
const placeholderSize = (fill: boolean) =>
  fill ? "h-full min-h-0" : "h-[70dvh] min-h-[28rem]";

function MapLoadingState() {
  return (
    // next/dynamic's `loading` takes no props, so this one size has to be
    // right in both places. `h-full` fills the phone's full-screen parent;
    // `min-h-[70dvh]` is what applies on desktop, where the parent has no
    // height of its own and matches what MapView settles at once loaded.
    <div
      className="relative grid h-full min-h-[70dvh] place-items-center overflow-hidden bg-[var(--color-muted)]/35 px-6 text-center"
      role="status"
      aria-live="polite"
      aria-busy="true"
    >
      <Skeleton className="absolute inset-0 rounded-none opacity-60" />
      <div className="relative">
        <span
          className="mx-auto grid size-11 place-items-center rounded-xl border border-[var(--color-border)] bg-[var(--color-card)] text-[var(--color-muted-foreground)] shadow-sm"
          aria-hidden="true"
        >
          <MapPinned className="size-5" />
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

class MapErrorBoundary extends Component<
  { children: ReactNode; listHref: string; fill?: boolean },
  { failed: boolean }
> {
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
        <div
          className={`grid ${placeholderSize(Boolean(this.props.fill))} place-items-center bg-[var(--color-muted)]/35 px-6 text-center`}
          role="alert"
        >
          <div className="max-w-sm">
            <span className="mx-auto grid size-11 place-items-center rounded-xl border border-[var(--color-border)] bg-[var(--color-card)] text-[var(--color-muted-foreground)] shadow-sm">
              <MapPinned className="size-5" aria-hidden="true" />
            </span>
            <h2 className="mt-3 text-base font-semibold">The interactive map could not start</h2>
            <p className="mt-2 text-sm leading-6 text-[var(--color-muted-foreground)]">
              Provider details are safe. Reload the page to try the map again, or use the list
              view to keep browsing.
            </p>
            <div className="mt-4 flex flex-wrap justify-center gap-3">
              <Button
                type="button"
                onClick={() => window.location.reload()}
              >
                <RefreshCw aria-hidden="true" />
                Reload map
              </Button>
              <Button asChild variant="outline">
                <Link href={this.props.listHref}>
                  <List aria-hidden="true" />
                  Use list view
                </Link>
              </Button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export function MapLoader({
  providers,
  listHref = "/",
  fill = false,
  immersive = false,
}: {
  providers: ProviderCard[];
  listHref?: string;
  /** Take the parent's height rather than a fixed fraction of the viewport. */
  fill?: boolean;
  /** Float the map's controls over the tiles. See MapView. */
  immersive?: boolean;
}) {
  // Avoid downloading Leaflet's client chunk when there is nothing to plot.
  if (providers.length === 0) {
    return (
      <div
        className={`grid ${placeholderSize(fill)} place-items-center bg-[var(--color-muted)]/35 px-6 text-center`}
        role="status"
      >
        <div className="max-w-sm">
          <span className="mx-auto grid size-11 place-items-center rounded-xl border border-[var(--color-border)] bg-[var(--color-card)] text-[var(--color-muted-foreground)] shadow-sm">
            <MapPinned className="size-5" aria-hidden="true" />
          </span>
          <h2 className="mt-3 text-base font-semibold">No provider locations to map</h2>
          <p className="mt-2 text-sm text-[var(--color-muted-foreground)]">
            Try the list view while provider locations are being added.
          </p>
        </div>
      </div>
    );
  }

  return (
    <MapErrorBoundary listHref={listHref} fill={fill}>
      <MapView providers={providers} fillParent={fill} immersive={immersive} />
    </MapErrorBoundary>
  );
}
