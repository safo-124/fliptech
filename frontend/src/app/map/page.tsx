/**
 * Screen 2 route. The map component is loaded client-side only, because Leaflet
 * touches `window` at import time and would break the server render.
 *
 * The provider list is still fetched on the server, so the map has its data in
 * the first payload rather than after a second round trip on a 3G connection.
 */

import Link from "next/link";
import { connection } from "next/server";
import type { ReactNode } from "react";
import { AlertTriangle, List, Map, MapPin, Route, SearchX } from "lucide-react";

import { MapLoader } from "@/components/MapLoader";
import { ProviderCard } from "@/components/ProviderCard";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { buildQuery, searchAllProviders, type SearchParams } from "@/lib/api";
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

function withoutPage(params: SearchParams): SearchParams {
  return { ...params, page: undefined };
}

function ViewSwitch({ listHref, mapHref }: { listHref: string; mapHref: string }) {
  return (
    <nav
      aria-label="Choose results view"
      className="flex rounded-xl border border-[var(--color-border)] bg-[var(--color-card)] p-1 shadow-xs"
    >
      <Button asChild variant="ghost" size="sm" className="min-h-11 rounded-lg px-3">
        <Link href={listHref}>
          <List aria-hidden="true" />
          List
        </Link>
      </Button>
      <Button asChild size="sm" className="min-h-11 rounded-lg px-3 shadow-none">
        <Link href={mapHref} aria-current="page">
          <Map aria-hidden="true" />
          Map
        </Link>
      </Button>
    </nav>
  );
}

function MapPageState({
  title,
  children,
  listHref,
  retryHref,
  alert = false,
}: {
  title: string;
  children: ReactNode;
  listHref: string;
  retryHref?: string;
  alert?: boolean;
}) {
  const Icon = alert ? AlertTriangle : SearchX;

  return (
    <div className="app-shell grid min-h-[58dvh] place-items-center py-10">
      <Card
        className="w-full max-w-xl border-[var(--color-border-strong)] p-6 text-center sm:p-8"
        role={alert ? "alert" : "status"}
        aria-live={alert ? "assertive" : "polite"}
      >
        <span
          className="mx-auto grid size-12 place-items-center rounded-2xl bg-[var(--color-brand-soft)] text-[var(--color-brand-strong)]"
          aria-hidden="true"
        >
          <Icon className="size-5" />
        </span>
        <h1 className="mt-4 text-xl font-bold tracking-tight">{title}</h1>
        <div className="mx-auto mt-2 max-w-md text-sm leading-6 text-[var(--color-muted-foreground)]">
          {children}
        </div>
        <div className="mt-5 flex flex-wrap justify-center gap-3">
          {retryHref ? (
            <Button asChild>
              <Link href={retryHref}>Try the map again</Link>
            </Button>
          ) : null}
          <Button asChild variant="outline">
            <Link href={listHref}>
              <List aria-hidden="true" />
              Use the list view
            </Link>
          </Button>
        </div>
      </Card>
    </div>
  );
}

export default async function MapPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  // The API may intentionally be offline while the frontend image builds.
  // Wait for a real request so that a temporary build-time outage cannot be
  // frozen into the production map's revalidated output.
  await connection();

  const raw = await searchParams;
  const params: SearchParams = withoutPage(
    Object.fromEntries(
      Object.entries(raw).map(([key, value]) => [key, Array.isArray(value) ? value[0] : value]),
    ),
  );
  const query = buildQuery(params);
  const listHref = `/${query}`;
  const mapHref = `/map${query}`;
  const hasActiveFilters = Object.values(params).some(Boolean);

  // This helper follows every DRF pagination link and throws if any page fails.
  // Rendering no map is more honest than labelling the first 20 markers with
  // the catalogue-wide count returned by the API.
  const providers = await searchAllProviders(params).catch(() => null);

  if (!providers) {
    return (
      <MapPageState
        title="We could not load the complete map"
        listHref={listHref}
        retryHref={mapHref}
        alert
      >
        <p>
          One or more pages of providers could not be loaded, so we have not shown an incomplete
          map.
        </p>
      </MapPageState>
    );
  }

  if (providers.length === 0) {
    return (
      <MapPageState
        title={hasActiveFilters ? "No provider locations match these filters" : "No provider locations yet"}
        listHref={listHref}
      >
        <p>
          {hasActiveFilters
            ? "Return to the list to adjust your filters and see more options."
            : "Published training providers will appear here as soon as they are available."}
        </p>
      </MapPageState>
    );
  }

  const mappableProviders = providers.filter(hasMappableCoordinates);
  const missingLocationCount = providers.length - mappableProviders.length;

  if (mappableProviders.length === 0) {
    return (
      <MapPageState title="Provider locations are unavailable" listHref={listHref} alert>
        <p>
          We loaded {providers.length} published {providers.length === 1 ? "provider" : "providers"},
          but none has a usable map location. The full records are still available in the list.
        </p>
      </MapPageState>
    );
  }

  return (
    <div className="app-shell py-6 sm:py-8">
      <header className="mb-5 flex flex-wrap items-end justify-between gap-4">
        <div>
          <Badge
            variant="outline"
            className="border-[var(--color-brand)]/20 bg-[var(--color-brand-soft)] text-[var(--color-brand-strong)]"
          >
            <Route aria-hidden="true" />
            {hasActiveFilters ? "Map with your active filters" : "Explore by location"}
          </Badge>
          <h1 className="mt-3 text-2xl font-bold tracking-tight sm:text-3xl">
            {mappableProviders.length} provider {mappableProviders.length === 1 ? "location" : "locations"}
          </h1>
          <p className="mt-1.5 max-w-2xl text-sm leading-6 text-[var(--color-muted-foreground)]">
            {hasActiveFilters
              ? "This map shows the complete provider set for the same filters as your list."
              : "See where published training workshops are located, then open a listing for fees and intake dates."}
          </p>
        </div>
        <ViewSwitch listHref={listHref} mapHref={mapHref} />
      </header>

      {missingLocationCount > 0 ? (
        <Card
          className="mb-4 flex-row items-start gap-3 border-[var(--color-warn)]/20 bg-[var(--color-warn-bg)] p-3.5 text-xs leading-5 text-[var(--color-warn)] shadow-none"
          role="status"
        >
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <p>
            {missingLocationCount} of {providers.length} published providers cannot be plotted
            because their location data is invalid. They remain available in the list view.
          </p>
        </Card>
      ) : null}

      <div className="lg:grid lg:grid-cols-[23rem_minmax(0,1fr)] lg:gap-5">
        {/* Hidden on a phone, where the map is the whole point of this screen. */}
        <ul
          className="hidden h-[70dvh] min-h-[28rem] space-y-4 overflow-y-auto pr-1 lg:block"
          data-map-comparison-list
          aria-label="Providers shown on the map"
        >
          {providers.map((provider) => (
            <li key={provider.id}>
              <ProviderCard provider={provider} />
            </li>
          ))}
        </ul>

        <Card className="overflow-hidden rounded-2xl border-[var(--color-border-strong)] shadow-[var(--shadow-lg)]">
          <MapLoader providers={mappableProviders} listHref={listHref} />
        </Card>
      </div>

      <div className="mt-4 flex items-start gap-2 text-xs leading-5 text-[var(--color-muted-foreground)]">
        <MapPin className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
        <p>
          The list view keeps fee, duration and next intake visible on every card, which makes
          comparing providers easier than the map does.
        </p>
      </div>
    </div>
  );
}
