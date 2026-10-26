/**
 * Screen 2 route. The map component is loaded client-side only, because Leaflet
 * touches `window` at import time and would break the server render.
 *
 * The provider list is still fetched on the server, so the map has its data in
 * the first payload rather than after a second round trip on a 3G connection.
 */

import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { useTranslations } from "next-intl";
import { getTranslations } from "next-intl/server";
import type { ReactNode } from "react";
import { AlertTriangle, List, Map, MapPin, Route, SearchX } from "lucide-react";

import { MapLoader } from "@/components/MapLoader";
import { ProviderCard } from "@/components/ProviderCard";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ClientMessages } from "@/i18n/ClientMessages";
import { MAP_CLIENT_NAMESPACES } from "@/i18n/namespaces";
import { buildQuery, searchAllProviders, type SearchParams } from "@/lib/api";
import { toMapProviders } from "@/lib/map-provider";
import type { ProviderCard as ProviderCardData } from "@/lib/types";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("MapPage");
  return { title: t("metaTitle"), description: t("metaDescription") };
}

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
  const t = useTranslations("SearchPage");
  return (
    <nav
      aria-label={t("chooseView")}
      className="flex rounded-xl border border-[var(--color-border)] bg-[var(--color-card)] p-1 shadow-xs"
    >
      <Button asChild variant="ghost" size="sm" className="min-h-11 rounded-lg px-3">
        <Link href={listHref}>
          <List aria-hidden="true" />
          {t("list")}
        </Link>
      </Button>
      <Button asChild size="sm" className="min-h-11 rounded-lg px-3 shadow-none">
        <Link href={mapHref} aria-current="page">
          <Map aria-hidden="true" />
          {t("map")}
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
  const t = useTranslations("MapPage");
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
              <Link href={retryHref}>{t("retry")}</Link>
            </Button>
          ) : null}
          <Button asChild variant="outline">
            <Link href={listHref}>
              <List aria-hidden="true" />
              {t("useList")}
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
  const listHref = `/training${query}`;
  const mapHref = `/map${query}`;
  const hasActiveFilters = Object.values(params).some(Boolean);

  // This helper follows every DRF pagination link and throws if any page fails.
  // Rendering no map is more honest than labelling the first 20 markers with
  // the catalogue-wide count returned by the API.
  const [providers, t] = await Promise.all([
    searchAllProviders(params).catch(() => null),
    getTranslations("MapPage"),
  ]);

  if (!providers) {
    return (
      <MapPageState title={t("incompleteTitle")} listHref={listHref} retryHref={mapHref} alert>
        <p>{t("incompleteBody")}</p>
      </MapPageState>
    );
  }

  if (providers.length === 0) {
    return (
      <MapPageState
        title={hasActiveFilters ? t("noMatchTitle") : t("noneYetTitle")}
        listHref={listHref}
      >
        <p>{hasActiveFilters ? t("noMatchBody") : t("noneYetBody")}</p>
      </MapPageState>
    );
  }

  const mappableProviders = providers.filter(hasMappableCoordinates);
  const missingLocationCount = providers.length - mappableProviders.length;

  if (mappableProviders.length === 0) {
    return (
      <MapPageState title={t("unavailableTitle")} listHref={listHref} alert>
        <p>{t("unavailableBody", { count: providers.length })}</p>
      </MapPageState>
    );
  }

  return (
    // No vertical padding on a phone: the map starts directly under the site
    // header and runs to the bottom of the screen.
    <div className="app-shell py-0 lg:py-8">
      {/* Kept in the accessibility tree and in the HTML for search engines, but
          off the screen on a phone — an h1 and three lines of description above
          a full-screen map is the panel-with-a-map-in-it this is meant to stop
          being. The count and the controls are on the map itself. */}
      <header className="sr-only mb-0 lg:not-sr-only lg:mb-5 lg:flex lg:flex-wrap lg:items-end lg:justify-between lg:gap-4">
        <div>
          <Badge
            variant="outline"
            className="border-[var(--color-brand)]/20 bg-[var(--color-brand-soft)] text-[var(--color-brand-strong)]"
          >
            <Route aria-hidden="true" />
            {hasActiveFilters ? t("badgeFiltered") : t("badgeExplore")}
          </Badge>
          <h1 className="mt-3 text-2xl font-bold tracking-tight sm:text-3xl">
            {t("locationCount", { count: mappableProviders.length })}
          </h1>
          <p className="mt-1.5 max-w-2xl text-sm leading-6 text-[var(--color-muted-foreground)]">
            {hasActiveFilters ? t("leadFiltered") : t("leadExplore")}
          </p>
        </div>
        <ViewSwitch listHref={listHref} mapHref={mapHref} />
      </header>

      {missingLocationCount > 0 ? (
        <Card
          className="mb-4 hidden flex-row items-start gap-3 border-[var(--color-warn)]/20 bg-[var(--color-warn-bg)] p-3.5 text-xs leading-5 text-[var(--color-warn)] shadow-none lg:flex"
          role="status"
        >
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <p>{t("missingLocations", { missing: missingLocationCount, count: providers.length })}</p>
        </Card>
      ) : null}

      <div className="lg:grid lg:grid-cols-[23rem_minmax(0,1fr)] lg:gap-5">
        {/* Hidden on a phone, where the map is the whole point of this screen. */}
        <ul
          className="hidden h-[70dvh] min-h-[28rem] space-y-4 overflow-y-auto pr-1 lg:block"
          data-map-comparison-list
          aria-label={t("listLabel")}
        >
          {providers.map((provider) => (
            <li key={provider.id}>
              <ProviderCard provider={provider} />
            </li>
          ))}
        </ul>

        {/* Full-bleed on a phone: -mx-3 cancels app-shell's gutter so the tiles
            reach both edges, and the height is everything under the 4rem site
            header. From lg it goes back to being a card in the grid. */}
        <div className="relative -mx-3 h-[calc(100dvh-4rem)] overflow-hidden bg-[var(--color-card)] lg:mx-0 lg:h-auto lg:rounded-2xl lg:border lg:border-[var(--color-border-strong)] lg:shadow-[var(--shadow-lg)]">
          <ClientMessages namespaces={MAP_CLIENT_NAMESPACES}>
            <MapLoader
              providers={toMapProviders(mappableProviders)}
              listHref={listHref}
              fill
              immersive
            />
          </ClientMessages>

          {/* Back to the list. The header's List/Map switch is off-screen on a
              phone now, so this is the way back, and it matches the "View on
              map" pill the results page uses in the other direction. */}
          <Link
            href={listHref}
            className="band absolute inset-x-0 bottom-9 z-[500] mx-auto inline-flex min-h-11 w-fit items-center gap-2 rounded-full px-5 py-3 text-sm font-semibold text-white shadow-[var(--shadow-lg)] ring-1 ring-white/20 lg:hidden"
          >
            <List aria-hidden="true" className="size-4" />
            {t("listView")}
          </Link>
        </div>
      </div>

      <div className="mt-4 hidden items-start gap-2 text-xs leading-5 text-[var(--color-muted-foreground)] lg:flex">
        <MapPin className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
        <p>{t("listAdvice")}</p>
      </div>
    </div>
  );
}
