"use client";

/**
 * The map beside the search results, on desktop only.
 *
 * Two constraints shape this, and both are load-bearing.
 *
 * 1. The ranked list stays the default. Section 04 warns that the map wins
 *    demonstrations and loses users, and that it must never become the default
 *    view. A side panel is not the same thing as a default: the list keeps the
 *    primary column, the ordering, and the fee/duration/intake comparison, and
 *    the map is a secondary read of the same result set. On a phone — the
 *    device the product is designed for — nothing changes at all.
 *
 * 2. The phone must not pay for it. Leaflet, react-leaflet and supercluster
 *    together are roughly 60 KB gzipped, and the search page has about 11 KB of
 *    headroom against the Section 10 budget. So the import is gated on an
 *    actual desktop viewport rather than on a CSS breakpoint: `dynamic()` only
 *    fetches the chunk when the component renders, and this renders nothing
 *    below 1024px. A `hidden lg:block` wrapper would have shipped the
 *    JavaScript to every phone and merely hidden the result.
 *
 * The viewport is read with useSyncExternalStore rather than an effect, so
 * there is no setState-in-effect cascade on mount.
 *
 * Its own two labels arrive translated from the page, for the same reason:
 * translating here would load next-intl's message formatter on every phone
 * too. The map itself still translates, inside the chunk only a desktop loads.
 */

import dynamic from "next/dynamic";
import { MapPinned } from "lucide-react";
import { createContext, useContext, useSyncExternalStore } from "react";

import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import type { ClientIntl } from "@/i18n/client-intl";
import type { MapProvider } from "@/lib/map-provider";

const DESKTOP_QUERY = "(min-width: 1024px)";

export type SearchMapPanelLabels = { loading: string; onThisPage: string };

// next/dynamic's `loading` takes no props, so its label comes through context.
const LoadingLabel = createContext("");

function PanelLoading() {
  const label = useContext(LoadingLabel);
  return (
    <div
      className="relative grid h-full place-items-center overflow-hidden bg-[var(--color-muted)]/35 text-sm text-[var(--color-muted-foreground)]"
      role="status"
      aria-live="polite"
    >
      <Skeleton className="absolute inset-0 rounded-none opacity-60" />
      <span className="relative grid place-items-center gap-3 font-medium">
        <span className="grid size-11 place-items-center rounded-xl border border-[var(--color-border)] bg-[var(--color-card)] shadow-sm">
          <MapPinned className="size-5" aria-hidden="true" />
        </span>
        {label}
      </span>
    </div>
  );
}

// The map and its messages provider together: see SearchMapWithMessages.
const MapView = dynamic(() => import("./SearchMapWithMessages"), {
  ssr: false,
  loading: PanelLoading,
});

function subscribe(onChange: () => void) {
  const media = window.matchMedia(DESKTOP_QUERY);
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}

function useIsDesktop() {
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(DESKTOP_QUERY).matches,
    () => false, // Server render: assume phone, which is the safe default here.
  );
}

export function SearchMapPanel({
  providers,
  labels,
  intl,
}: {
  providers: MapProvider[];
  labels: SearchMapPanelLabels;
  /** For the map's own provider, rendered inside its lazy chunk. */
  intl: ClientIntl;
}) {
  const isDesktop = useIsDesktop();

  if (!isDesktop) return null;

  return (
    <Card className="h-[clamp(30rem,calc(100dvh-6.5rem),54rem)] overflow-hidden rounded-2xl border-[var(--color-border-strong)] shadow-[var(--shadow-lg)]">
      <LoadingLabel.Provider value={labels.loading}>
        <MapView intl={intl} providers={providers} fillParent scopeLabel={labels.onThisPage} />
      </LoadingLabel.Provider>
    </Card>
  );
}
