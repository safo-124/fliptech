/**
 * Screen 1: search results. The default view.
 *
 * Results are ordered by distance from the point the user chose rather than by
 * who paid most, which keeps the ranking defensible. Without a chosen point the
 * API falls back to a stable alphabetical order rather than inventing relevance.
 *
 * The page is a Server Component. On a phone it ships no client JavaScript at
 * all; the map panel below is the only client code, and it is gated on an
 * actual desktop viewport so a phone never downloads it.
 */

import Link from "next/link";
import {
  ArrowLeft,
  ArrowRight,
  Building2,
  GraduationCap,
  List,
  Map,
  MapPin,
  SearchX,
  TriangleAlert,
} from "lucide-react";
import type { Metadata } from "next";
import { useTranslations } from "next-intl";
import { getTranslations } from "next-intl/server";

import { BrandShards } from "@/components/BrandShards";
import { FilterBar } from "@/components/FilterBar";
import { IntakesBoard } from "@/components/IntakesBoard";
import { ProviderCard } from "@/components/ProviderCard";
import { SearchMapPanel } from "@/components/SearchMapPanel";
import { TradeArt } from "@/components/TradeArt";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { clientIntl } from "@/i18n/client-intl";
import { MAP_CLIENT_NAMESPACES } from "@/i18n/namespaces";
import {
  buildQuery,
  getAllRegions,
  getTrades,
  getUpcomingIntakes,
  searchProviders,
  type SearchParams,
} from "@/lib/api";
import { coverageSuffix, launchedRegionNames } from "@/lib/coverage";
import { toMapProviders } from "@/lib/map-provider";
import { BRAND } from "@/lib/brand";
import { titleCase } from "@/lib/format";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("SearchPage");
  // Deliberately not region-aware. A title that changed as regions launched
  // would churn the one string search engines have indexed longest, and the
  // product is national whichever regions happen to be live this month.
  return { title: t("metaTitle") };
}

function withoutPage(params: SearchParams): SearchParams {
  return { ...params, page: undefined };
}

function listPageHref(params: SearchParams, page: number) {
  const next = { ...params, page: page > 1 ? String(page) : undefined };
  return `/training${buildQuery(next)}`;
}

function ResultsViewSwitch({ listHref, mapHref }: { listHref: string; mapHref: string }) {
  const t = useTranslations("SearchPage");
  return (
    <nav
      aria-label={t("chooseView")}
      className="flex rounded-xl border border-[var(--color-border)] bg-[var(--color-card)] p-1 shadow-xs"
    >
      <Button asChild size="sm" className="min-h-11 rounded-lg px-3 shadow-none">
        <Link href={listHref} aria-current="page">
          <List aria-hidden="true" />
          {t("list")}
        </Link>
      </Button>
      <Button asChild variant="ghost" size="sm" className="min-h-11 rounded-lg px-3">
        <Link href={mapHref}>
          <Map aria-hidden="true" />
          {t("map")}
        </Link>
      </Button>
    </nav>
  );
}

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const raw = await searchParams;
  const params: SearchParams = Object.fromEntries(
    Object.entries(raw).map(([key, value]) => [key, Array.isArray(value) ? value[0] : value]),
  );

  const unfiltered = !Object.entries(params).some(([key, value]) => value && key !== "page");
  // The departures board belongs to browsing, not to a search someone has
  // narrowed: it shows on the plain first page only, and is not even fetched
  // otherwise.
  const showBoard = unfiltered && (!params.page || params.page === "1");

  const [trades, results, regions, regionNames, t, tCoverage, tMap, mapIntl, upcoming] = await Promise.all([
    getTrades().catch(() => ({ results: [] })),
    searchProviders(params).catch(() => null),
    // The same request launchedRegionNames makes, so it is fetched once.
    getAllRegions().catch(() => []),
    launchedRegionNames(),
    getTranslations("SearchPage"),
    getTranslations("Coverage"),
    getTranslations("SearchMapPanel"),
    clientIntl(MAP_CLIENT_NAMESPACES),
    showBoard ? getUpcomingIntakes().catch(() => []) : Promise.resolve([]),
  ]);
  // "in Greater Accra" while that is the only live region, "across Ghana"
  // once naming them stops being readable.
  const coverage = coverageSuffix(regionNames, tCoverage);

  const mapHref = `/map${buildQuery(withoutPage(params))}`;
  const listHref = `/training${buildQuery(params)}`;
  const currentPage = Math.max(1, Number.parseInt(params.page ?? "1", 10) || 1);
  const groupSize = Number.parseInt(params.places ?? "", 10);
  const tradeTitle = params.trade
    ? t("tradeProviders", { trade: titleCase(params.trade) })
    : t("allProviders");
  const resultTitle =
    groupSize > 0 ? t("withRoomFor", { title: tradeTitle, size: groupSize }) : tradeTitle;
  const searchedTrade = trades.results.find((trade) => trade.slug === params.trade) ?? null;
  // The places the sentence offers: areas with a workshop in them, so no
  // choice leads to an empty page.
  const areas = regions
    .flatMap((region) => region.areas)
    .filter((area) => area.provider_count > 0)
    .map((area) => ({ slug: area.slug, name: area.name }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const boardInHero = showBoard && upcoming.length > 0;

  return (
    <>
      {/* The hero, the search and the board share one positioning context: on
          a wide screen the board sits in the hero's right half, and on a phone
          it follows the trade tiles. One element, placed by CSS, so it is not
          rendered twice. */}
      <div className="relative">
      {/* The hero continues the header's indigo rather than sitting below it as
          a separate light block, so the brand reads as one field the page
          emerges from. The search card then breaks the band's lower edge,
          which is what stops this looking like a stock hero-over-form. */}
      <section
        className={`band relative isolate overflow-hidden pb-20 sm:pb-24 ${boardInHero ? "xl:min-h-[25rem]" : ""}`}
      >
        <div
          className="surface-grid pointer-events-none absolute inset-0 opacity-[0.07]"
          aria-hidden="true"
        />
        {/* Anchored bottom-right, behind the search card that overlaps this
            band's edge, so the wedges read as depth rather than as clutter.
            Where the board takes the hero's right half, it replaces them. Not
            on a phone, where the headline and the sentence fill the width and
            the wedges only crowd them. */}
        <BrandShards
          className={`pointer-events-none absolute -bottom-10 right-0 h-[19rem] w-[22rem] opacity-70 max-sm:hidden sm:h-[23rem] sm:w-[28rem] ${boardInHero ? "xl:hidden" : ""}`}
        />
        <div className="app-shell relative z-10 pt-8 sm:pt-10 lg:pt-14">
          <div className="max-w-3xl">
            <span className="badge border-white/20 bg-white/10 text-white/80 backdrop-blur-sm">
              <MapPin aria-hidden="true" className="size-3.5" />
              {unfiltered && results
                ? t("heroCount", { count: results.count, coverage })
                : t("heroBadge", { coverage })}
            </span>
            <h1 className="mt-4 max-w-2xl text-3xl font-bold leading-[1.05] tracking-[-0.035em] text-white sm:text-4xl lg:text-[3.25rem]">
              {t.rich("heroTitle", {
                highlight: (chunks) => (
                  <span className="bg-gradient-to-r from-[var(--color-sand)] via-[var(--color-peach)] to-[var(--color-coral)] bg-clip-text text-transparent">
                    {chunks}
                  </span>
                ),
              })}
            </h1>
            {/* Not on a phone, where the search should start on the first
                screen and the headline already says it. */}
            <p className="mt-4 max-w-xl text-sm leading-6 text-white/70 max-sm:hidden sm:text-base sm:leading-7">
              {t("heroLead")}
            </p>
          </div>
        </div>
      </section>

      {/* Pulled up over the band's edge. -mt matches the pb above. */}
      <div className="app-shell relative z-20 -mt-14 sm:-mt-16">
        <FilterBar
          trades={trades.results}
          areas={areas}
          params={params}
          total={unfiltered && results ? results.count : null}
        />
      </div>

      {boardInHero ? (
        <div className="xl:pointer-events-none xl:absolute xl:inset-x-0 xl:top-0 xl:z-10">
          <div className="app-shell pt-6 sm:pt-8 xl:flex xl:justify-end xl:pt-14">
            <div className="xl:pointer-events-auto xl:w-[25rem]">
              <IntakesBoard
                intakes={upcoming}
                className="xl:bg-none xl:bg-white/[0.07] xl:ring-1 xl:ring-white/15"
              />
            </div>
          </div>
        </div>
      ) : null}
      </div>

      {/* pb-24 on phones clears the floating map button below, so it never
          covers the last result card. */}
      <section
        className="app-shell pt-6 pb-24 sm:pt-8 lg:pb-8"
        aria-labelledby="search-results-heading"
      >
        {results === null ? (
          // Section 10: api.ts has already retried twice, so this is a genuine
          // outage rather than a dropped packet. The filters above stay usable.
          <Card
            className="border-[var(--color-warn)]/20 bg-[var(--color-warn-bg)] p-5 text-[var(--color-warn)] sm:p-6"
            role="alert"
          >
            <div className="flex items-start gap-3">
              <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-white/70">
                <TriangleAlert className="size-5" aria-hidden="true" />
              </span>
              <div>
                <h2 id="search-results-heading" className="font-semibold text-[var(--color-foreground)]">
                  {t("loadFailedTitle")}
                </h2>
                <p className="mt-1 text-sm leading-6">
                  {t("loadFailedBody")}
                </p>
                <Button asChild variant="outline" className="mt-4">
                  <Link href={`/training${buildQuery(params)}`}>{t("tryAgain")}</Link>
                </Button>
              </div>
            </div>
          </Card>
        ) : (
          <>
            <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--color-brand-strong)]">
                  {t("exploreOptions")}
                </p>
                <h2
                  id="search-results-heading"
                  className="mt-1 text-xl font-bold tracking-tight sm:text-2xl"
                >
                  {resultTitle}
                </h2>
                <p className="mt-1 text-sm text-[var(--color-muted-foreground)]">
                  {results.results.length === results.count
                    ? t("providerCount", { count: results.count })
                    : t("pageCount", { shown: results.results.length, count: results.count })}
                </p>
              </div>
              <ResultsViewSwitch listHref={listHref} mapHref={mapHref} />
            </div>

            {/* Phone-only route to the map.
                The switch above is the desktop affordance, but on a phone it
                wraps under the heading and sits above the fold only until the
                first scroll — so in practice the map was unreachable without
                knowing it was there.
                A plain link, not a client component: the /map route loads
                Leaflet itself, so a phone that never taps this still downloads
                none of it and the Section 10 budget is untouched. The list
                also stays the default view, which Section 04 requires. */}
            {results.count > 0 ? (
              <Link
                href={mapHref}
                className="band fixed inset-x-0 bottom-5 z-[900] mx-auto inline-flex min-h-11 w-fit items-center gap-2 rounded-full px-5 py-3 text-sm font-semibold text-white shadow-[var(--shadow-lg)] ring-1 ring-white/20 lg:hidden"
              >
                <Map aria-hidden="true" className="size-4" />
                {t("viewOnMap", { count: results.count })}
              </Link>
            ) : null}

            {results.count === 0 ? (
              <Card className="grid min-h-64 place-items-center border-dashed p-6 text-center">
                <div className="max-w-md">
                  {/* The searched trade's own picture when there is one to
                      show: an empty search for welding still looks like
                      welding, not like an error. */}
                  {searchedTrade ? (
                    <TradeArt
                      colour={searchedTrade.colour}
                      picture={searchedTrade.picture}
                      className="mx-auto size-20"
                      sizes="80px"
                    />
                  ) : (
                    <span className="mx-auto grid size-12 place-items-center rounded-2xl bg-[var(--color-secondary)] text-[var(--color-muted-foreground)]">
                      <SearchX className="size-5" aria-hidden="true" />
                    </span>
                  )}
                  <h3 className="mt-4 text-lg font-semibold">{t("noMatchTitle")}</h3>
                  <p className="mt-2 text-sm leading-6 text-[var(--color-muted-foreground)]">
                    {t("noMatchBody")}
                  </p>
                  <Button asChild variant="outline" className="mt-5">
                    <Link href="/training">{t("clearAllFilters")}</Link>
                  </Button>
                </div>
              </Card>
            ) : (
              <>
                {/*
                 * Results left, map right, from `lg` upwards. The list keeps
                 * the primary column. Auto-fit adds a third card only when it
                 * can remain at least 19rem wide.
                 */}
                <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_28rem] lg:gap-5 xl:grid-cols-[minmax(0,1fr)_34rem]">
                  <ul
                    className="grid grid-cols-1 items-stretch gap-4 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-[repeat(auto-fit,minmax(19rem,1fr))]"
                    aria-labelledby="search-results-heading"
                  >
                    {results.results.map((provider) => (
                      <li key={provider.id} className="min-w-0">
                        <ProviderCard provider={provider} />
                      </li>
                    ))}
                  </ul>

                  <aside className="hidden lg:block" aria-label={t("mapOfPage")}>
                    <div className="sticky top-[5.5rem]">
                      {/* No ClientMessages here: its provider would load the
                          message formatter on every phone. The map brings its
                          own, lazily. See SearchMapWithMessages. */}
                      <SearchMapPanel
                        providers={toMapProviders(results.results)}
                        labels={{ loading: tMap("loading"), onThisPage: tMap("onThisPage") }}
                        intl={mapIntl}
                      />
                    </div>
                  </aside>
                </div>

                {results.previous || results.next ? (
                  <nav
                    className="mt-6 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[var(--color-border)] bg-[var(--color-card)] p-2 shadow-xs lg:mr-[29.25rem] xl:mr-[35.25rem]"
                    aria-label={t("resultPages")}
                  >
                    {results.previous ? (
                      <Button asChild variant="ghost">
                        <Link href={listPageHref(params, currentPage - 1)} rel="prev">
                          <ArrowLeft aria-hidden="true" />
                          {t("previous")}
                        </Link>
                      </Button>
                    ) : (
                      <span />
                    )}
                    <span className="px-2 text-xs font-semibold text-[var(--color-muted-foreground)]">
                      {t("pageNumber", { page: currentPage })}
                    </span>
                    {results.next ? (
                      <Button asChild variant="ghost">
                        <Link href={listPageHref(params, currentPage + 1)} rel="next">
                          {t("next")}
                          <ArrowRight aria-hidden="true" />
                        </Link>
                      </Button>
                    ) : (
                      <span />
                    )}
                  </nav>
                ) : null}

                <Card className="mt-6 border-[var(--color-brand)]/15 bg-[var(--color-brand-soft)]/55 p-4 shadow-none lg:mr-[29.25rem] xl:mr-[35.25rem]">
                  <p className="text-xs leading-5 text-[var(--color-muted-foreground)]">
                    {t("compareAdvice")}
                  </p>
                </Card>
              </>
            )}
          </>
        )}
      </section>

      {/* Sign-up band. Plain links, so the search page still ships no client JS. */}
      <section
        aria-labelledby="join-heading"
        className="app-shell pb-10 sm:pb-14"
      >
        <div className="grid gap-4 rounded-3xl border border-[var(--color-border)] bg-[var(--color-card)] p-5 shadow-[var(--shadow-card)] sm:p-7 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] lg:items-center">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--color-brand-strong)]">
              {t("joinEyebrow")}
            </p>
            <h2 id="join-heading" className="mt-1 text-2xl font-bold tracking-tight">
              {t("joinTitle")}
            </h2>
            <p className="mt-2 text-sm leading-6 text-[var(--color-muted-foreground)]">
              {t("joinBody", { brand: BRAND })}
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Link
              href="/trainee/sign-in?new=1"
              className="group flex items-center gap-3 rounded-2xl border border-[var(--color-border)] p-4 transition hover:border-[var(--color-brand)]/40 hover:bg-[var(--color-brand-soft)]/40"
            >
              <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-[var(--color-brand-soft)] text-[var(--color-brand-strong)]">
                <GraduationCap aria-hidden="true" className="size-5" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block font-semibold">{t("learnTitle")}</span>
                <span className="block text-xs text-[var(--color-muted-foreground)]">{t("learnBody")}</span>
              </span>
              <ArrowRight aria-hidden="true" className="size-4 text-[var(--color-muted-foreground)] group-hover:text-[var(--color-brand-strong)]" />
            </Link>
            <Link
              href="/trainer/join?new=1"
              className="group flex items-center gap-3 rounded-2xl border border-[var(--color-border)] p-4 transition hover:border-[var(--color-brand)]/40 hover:bg-[var(--color-brand-soft)]/40"
            >
              <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-[var(--color-brand-soft)] text-[var(--color-brand-strong)]">
                <Building2 aria-hidden="true" className="size-5" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block font-semibold">{t("trainTitle")}</span>
                <span className="block text-xs text-[var(--color-muted-foreground)]">{t("trainBody")}</span>
              </span>
              <ArrowRight aria-hidden="true" className="size-4 text-[var(--color-muted-foreground)] group-hover:text-[var(--color-brand-strong)]" />
            </Link>
          </div>
        </div>
      </section>
    </>
  );
}
