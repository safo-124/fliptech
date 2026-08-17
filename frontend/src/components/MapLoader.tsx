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

import type { ProviderCard } from "@/lib/types";

const MapView = dynamic(() => import("./MapView"), {
  ssr: false,
  loading: () => (
    <div className="grid h-[70dvh] place-items-center text-sm text-[var(--color-ink-soft)]">
      Loading map…
    </div>
  ),
});

export function MapLoader({ providers }: { providers: ProviderCard[] }) {
  return <MapView providers={providers} />;
}
