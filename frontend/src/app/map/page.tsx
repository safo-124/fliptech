/**
 * Screen 2 route. The map component is loaded client-side only, because Leaflet
 * touches `window` at import time and would break the server render.
 *
 * The provider list is still fetched on the server, so the map has its data in
 * the first payload rather than after a second round trip on a 3G connection.
 *
 * On a desktop the ranked list sits beside the map rather than being replaced
 * by it. The map wins demonstrations and loses users; where there is room for
 * both, the comparison tool stays on screen.
 */

import Link from "next/link";
import { connection } from "next/server";
import type { ReactNode } from "react";

import { MapLoader } from "@/components/MapLoader";
import { ProviderCard } from "@/components/ProviderCard";
import { searchAllProviders } from "@/lib/api";
import type { ProviderCard as ProviderCardData } from "@/lib/types";

export const metadata = {
  title: "Map of training providers",
  description: "See every published skills training provider on one map.",
};

function hasMappableCoordinates(provider: ProviderCardData) {
  return (
    Number.isFinite(provider.lat) &&
    Number.isFinite(provider.lng) &&
    provider.lat >= -90 &&
    provider.lat <= 90 &&
    provider.lng >= -180 &&
    provider.lng <= 180
  );
}

function MapPageState({
  title,
  children,
  alert = false,
}: {
  title: string;
  children: ReactNode;
  alert?: boolean;
}) {
  return (
    <div className="mx-auto grid min-h-[55dvh] max-w-xl place-items-center px-4 py-10">
      <section
        className="card w-full p-6 text-center sm:p-8"
        role={alert ? "alert" : "status"}
        aria-live={alert ? "assertive" : "polite"}
      >
        <span
          className="mx-auto mb-4 grid size-11 place-items-center rounded-lg border border-[var(--color-border)] bg-[var(--color-muted)] text-[var(--color-muted-foreground)]"
          aria-hidden="true"
        >
          <svg viewBox="0 0 24 24" className="size-5 fill-none stroke-current stroke-[1.8]">
            <path d="m9 18-6 3V6l6-3 6 3 6-3v15l-6 3-6-3Z" />
            <path d="M9 3v15M15 6v15" />
          </svg>
        </span>
        <h1 className="text-lg font-semibold tracking-tight">{title}</h1>
        <div className="mt-2 text-sm leading-6 text-[var(--color-muted-foreground)]">
          {children}
        </div>
      </section>
    </div>
  );
}

export default async function MapPage() {
  // The API may intentionally be offline while the frontend image builds.
  // Wait for a real request so that a temporary build-time outage cannot be
  // frozen into the production map's revalidated output.
  await connection();

  // This helper follows every DRF pagination link and throws if any page fails.
  // Rendering no map is more honest than labelling the first 20 markers with
  // the catalogue-wide count returned by the API.
  const providers = await searchAllProviders().catch(() => null);

  if (!providers) {
    return (
      <MapPageState title="We could not load the complete map" alert>
        <p>
          One or more pages of providers could not be loaded, so we have not shown an
          incomplete map.
        </p>
        <div className="mt-5 flex flex-wrap justify-center gap-3">
          <Link href="/map" className="tap rounded-md bg-[var(--color-primary)] px-4 text-[var(--color-primary-foreground)]">
            Try the map again
          </Link>
          <Link href="/" className="tap rounded-md border border-[var(--color-border)] px-4 text-[var(--color-foreground)]">
            Use the list view
          </Link>
        </div>
      </MapPageState>
    );
  }

  if (providers.length === 0) {
    return (
      <MapPageState title="No provider locations yet">
        <p>Published training providers will appear here as soon as they are available.</p>
        <Link href="/" className="tap mt-5 rounded-md border border-[var(--color-border)] px-4 text-[var(--color-foreground)]">
          Browse the list view
        </Link>
      </MapPageState>
    );
  }

  const mappableProviders = providers.filter(hasMappableCoordinates);
  const missingLocationCount = providers.length - mappableProviders.length;

  if (mappableProviders.length === 0) {
    return (
      <MapPageState title="Provider locations are unavailable" alert>
        <p>
          We loaded {providers.length} published {providers.length === 1 ? "provider" : "providers"},
          but none has a usable map location. The full records are still available in the list.
        </p>
        <Link href="/" className="tap mt-5 rounded-md border border-[var(--color-border)] px-4 text-[var(--color-foreground)]">
          Use the list view
        </Link>
      </MapPageState>
    );
  }

  return (
    <div>
      <header className="flex items-center justify-between gap-4 px-3 py-3 lg:px-6 lg:py-4">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-[var(--color-muted-foreground)]">
            Explore by location
          </p>
          <h1 className="mt-0.5 text-base font-semibold tracking-tight lg:text-lg">
            {mappableProviders.length} provider {mappableProviders.length === 1 ? "location" : "locations"}
          </h1>
        </div>
        <Link href="/" className="tap shrink-0 rounded-md border border-[var(--color-border)] px-3 text-sm">
          Back to list
        </Link>
      </header>

      {missingLocationCount > 0 ? (
        <p
          className="mx-3 mb-3 rounded-md border border-[var(--color-border)] bg-[var(--color-muted)] px-3 py-2 text-xs text-[var(--color-muted-foreground)] lg:mx-6"
          role="status"
        >
          {missingLocationCount} of {providers.length} published providers cannot be plotted because
          their location data is invalid. They remain available in the list view.
        </p>
      ) : null}

      <div className="lg:grid lg:grid-cols-[22rem_minmax(0,1fr)] lg:gap-4 lg:px-6">
        {/* Hidden on a phone, where the map is the whole point of this screen. */}
        <ul className="hidden max-h-[75dvh] space-y-3 overflow-y-auto pr-1 lg:block">
          {providers.map((provider) => (
            <li key={provider.id}>
              <ProviderCard provider={provider} />
            </li>
          ))}
        </ul>

        <div className="lg:overflow-hidden lg:rounded-lg lg:border lg:border-[var(--color-border)]">
          <MapLoader providers={mappableProviders} />
        </div>
      </div>

      <p className="max-w-prose px-3 py-3 text-xs text-[var(--color-muted-foreground)] lg:px-6">
        The list view shows fee, duration and next intake on each card, which makes comparing
        easier than the map does.
      </p>
    </div>
  );
}
