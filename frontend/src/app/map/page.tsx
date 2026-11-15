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
import { AlertTriangle, List, SearchX } from "lucide-react";

import { ExploreMapLoader } from "@/components/MapLoader";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ClientMessages } from "@/i18n/ClientMessages";
import { MAP_CLIENT_NAMESPACES } from "@/i18n/namespaces";
import { buildQuery, searchAllProviders, type SearchParams } from "@/lib/api";
import { toExploreProviders } from "@/lib/map-provider";
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
    // The whole screen under the site header is map. The heading stays in
    // the HTML for search engines and screen readers; everything a sighted
    // visitor needs floats on the map itself (see map/ExploreMap).
    // ml-[calc(50%-50vw)] w-screen lets it out of the layout's content
    // width to reach both edges of the screen (globals.css clips the
    // scrollbar's few pixels of overflow).
    <div className="relative ml-[calc(50%-50vw)] h-[calc(100dvh-4rem)] min-h-[32rem] w-screen lg:h-[calc(100dvh-4.5rem)]">
      <h1 className="sr-only">{t("locationCount", { count: mappableProviders.length })}</h1>
      <p className="sr-only">{hasActiveFilters ? t("leadFiltered") : t("leadExplore")}</p>
      <ClientMessages namespaces={MAP_CLIENT_NAMESPACES}>
        <ExploreMapLoader
          providers={toExploreProviders(mappableProviders)}
          listHref={listHref}
          missingCount={missingLocationCount}
        />
      </ClientMessages>
    </div>
  );
}
