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
  Sparkles,
  TriangleAlert,
} from "lucide-react";

import { BrandShards } from "@/components/BrandShards";
import { FilterBar } from "@/components/FilterBar";
import { ProviderCard } from "@/components/ProviderCard";
import { SearchMapPanel } from "@/components/SearchMapPanel";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { buildQuery, getTrades, searchProviders, type SearchParams } from "@/lib/api";
import { titleCase } from "@/lib/format";

export const metadata = {
  title: "Find skills training near you in Greater Accra",
};

function withoutPage(params: SearchParams): SearchParams {
  return { ...params, page: undefined };
}

function listPageHref(params: SearchParams, page: number) {
  const next = { ...params, page: page > 1 ? String(page) : undefined };
  return `/${buildQuery(next)}`;
}

function ResultsViewSwitch({ listHref, mapHref }: { listHref: string; mapHref: string }) {
  return (
    <nav
      aria-label="Choose results view"
      className="flex rounded-xl border border-[var(--color-border)] bg-[var(--color-card)] p-1 shadow-xs"
    >
      <Button asChild size="sm" className="min-h-11 rounded-lg px-3 shadow-none">
        <Link href={listHref} aria-current="page">
          <List aria-hidden="true" />
          List
        </Link>
      </Button>
      <Button asChild variant="ghost" size="sm" className="min-h-11 rounded-lg px-3">
        <Link href={mapHref}>
          <Map aria-hidden="true" />
          Map
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

  const [trades, results] = await Promise.all([
    getTrades().catch(() => ({ results: [] })),
    searchProviders(params).catch(() => null),
  ]);

  const mapHref = `/map${buildQuery(withoutPage(params))}`;
  const listHref = `/${buildQuery(params)}`;
  const currentPage = Math.max(1, Number.parseInt(params.page ?? "1", 10) || 1);
  const resultTitle = params.trade
    ? `${titleCase(params.trade)} training providers`
    : "Training providers";

  return (
    <>
      {/* The hero continues the header's indigo rather than sitting below it as
          a separate light block, so the brand reads as one field the page
          emerges from. The filter card then breaks the band's lower edge,
          which is what stops this looking like a stock hero-over-form. */}
      <section className="band relative isolate overflow-hidden pb-20 sm:pb-24">
        <div
          className="surface-grid pointer-events-none absolute inset-0 opacity-[0.07]"
          aria-hidden="true"
        />
        {/* Anchored bottom-right, behind the filter card that overlaps this
            band's edge, so the wedges read as depth rather than as clutter. */}
        <BrandShards className="pointer-events-none absolute -bottom-10 right-0 h-[19rem] w-[22rem] opacity-70 sm:h-[23rem] sm:w-[28rem]" />
        <div className="app-shell relative z-10 pt-8 sm:pt-10 lg:pt-14">
          <div className="max-w-3xl">
            <span className="badge border-white/20 bg-white/10 text-white/80 backdrop-blur-sm">
              <MapPin aria-hidden="true" className="size-3.5" />
              Practical training across Greater Accra
            </span>
            <h1 className="mt-4 max-w-2xl text-3xl font-bold leading-[1.05] tracking-[-0.035em] text-white sm:text-4xl lg:text-[3.25rem]">
              Find training that fits your plans and{" "}
              <span className="bg-gradient-to-r from-[var(--color-sand)] via-[var(--color-peach)] to-[var(--color-coral)] bg-clip-text text-transparent">
                your pocket
              </span>
              .
            </h1>
            <p className="mt-4 max-w-xl text-sm leading-6 text-white/70 sm:text-base sm:leading-7">
              Compare course fees, duration and next intake dates before you spend time or money
              travelling to a workshop.
            </p>
          </div>
        </div>
      </section>

      {/* Pulled up over the band's edge. -mt matches the pb above. */}
      <div className="app-shell relative z-20 -mt-14 sm:-mt-16">
        <FilterBar trades={trades.results} params={params} />
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
                  We could not load providers just now
                </h2>
                <p className="mt-1 text-sm leading-6">
                  Check your connection and try again. Your filters are still available above.
                </p>
                <Button asChild variant="outline" className="mt-4">
                  <Link href={`/${buildQuery(params)}`}>Try again</Link>
                </Button>
              </div>
            </div>
          </Card>
        ) : (
          <>
            <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--color-brand-strong)]">
                  Explore your options
                </p>
                <h2
                  id="search-results-heading"
                  className="mt-1 text-xl font-bold tracking-tight sm:text-2xl"
                >
                  {resultTitle}
                </h2>
                <p className="mt-1 text-sm text-[var(--color-muted-foreground)]">
                  {results.results.length === results.count
                    ? `${results.count} ${results.count === 1 ? "provider" : "providers"}`
                    : `${results.results.length} on this page · ${results.count} total`}
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
                View {results.count} on map
              </Link>
            ) : null}

            {results.count === 0 ? (
              <Card className="grid min-h-64 place-items-center border-dashed p-6 text-center">
                <div className="max-w-md">
                  <span className="mx-auto grid size-12 place-items-center rounded-2xl bg-[var(--color-secondary)] text-[var(--color-muted-foreground)]">
                    <SearchX className="size-5" aria-hidden="true" />
                  </span>
                  <h3 className="mt-4 text-lg font-semibold">No providers match those filters yet</h3>
                  <p className="mt-2 text-sm leading-6 text-[var(--color-muted-foreground)]">
                    Try removing the fee limit, changing your search, or choosing all trades.
                  </p>
                  <Button asChild variant="outline" className="mt-5">
                    <Link href="/">Clear all filters</Link>
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

                  <aside className="hidden lg:block" aria-label="Map of providers on this page">
                    <div className="sticky top-[5.5rem]">
                      <SearchMapPanel providers={results.results} />
                    </div>
                  </aside>
                </div>

                {results.previous || results.next ? (
                  <nav
                    className="mt-6 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[var(--color-border)] bg-[var(--color-card)] p-2 shadow-xs lg:mr-[29.25rem] xl:mr-[35.25rem]"
                    aria-label="Provider result pages"
                  >
                    {results.previous ? (
                      <Button asChild variant="ghost">
                        <Link href={listPageHref(params, currentPage - 1)} rel="prev">
                          <ArrowLeft aria-hidden="true" />
                          Previous
                        </Link>
                      </Button>
                    ) : (
                      <span />
                    )}
                    <span className="px-2 text-xs font-semibold text-[var(--color-muted-foreground)]">
                      Page {currentPage}
                    </span>
                    {results.next ? (
                      <Button asChild variant="ghost">
                        <Link href={listPageHref(params, currentPage + 1)} rel="next">
                          Next
                          <ArrowRight aria-hidden="true" />
                        </Link>
                      </Button>
                    ) : (
                      <span />
                    )}
                  </nav>
                ) : null}

                <Card className="mt-6 flex-row items-start gap-3 border-[var(--color-brand)]/15 bg-[var(--color-brand-soft)]/55 p-4 shadow-none lg:mr-[29.25rem] xl:mr-[35.25rem]">
                  <Sparkles
                    className="mt-0.5 size-4 shrink-0 text-[var(--color-brand-strong)]"
                    aria-hidden="true"
                  />
                  <p className="text-xs leading-5 text-[var(--color-muted-foreground)]">
                    Enquire with three providers before you decide. Comparing is free and is the
                    best way to understand what a fair fee looks like.
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
              Join Skills Hub
            </p>
            <h2 id="join-heading" className="mt-1 text-2xl font-bold tracking-tight">
              Sign up with just your phone number
            </h2>
            <p className="mt-2 text-sm leading-6 text-[var(--color-muted-foreground)]">
              No password. Trainees keep their enquiries in one place. Workshops are confirmed by
              Fliptech before they appear here.
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Link
              href="/trainee/sign-in"
              className="group flex items-center gap-3 rounded-2xl border border-[var(--color-border)] p-4 transition hover:border-[var(--color-brand)]/40 hover:bg-[var(--color-brand-soft)]/40"
            >
              <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-[var(--color-brand-soft)] text-[var(--color-brand-strong)]">
                <GraduationCap aria-hidden="true" className="size-5" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block font-semibold">I want to learn</span>
                <span className="block text-xs text-[var(--color-muted-foreground)]">Sign up as a trainee</span>
              </span>
              <ArrowRight aria-hidden="true" className="size-4 text-[var(--color-muted-foreground)] group-hover:text-[var(--color-brand-strong)]" />
            </Link>
            <Link
              href="/trainer/join"
              className="group flex items-center gap-3 rounded-2xl border border-[var(--color-border)] p-4 transition hover:border-[var(--color-brand)]/40 hover:bg-[var(--color-brand-soft)]/40"
            >
              <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-[var(--color-brand-soft)] text-[var(--color-brand-strong)]">
                <Building2 aria-hidden="true" className="size-5" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block font-semibold">I train people</span>
                <span className="block text-xs text-[var(--color-muted-foreground)]">Sign up as a trainer</span>
              </span>
              <ArrowRight aria-hidden="true" className="size-4 text-[var(--color-muted-foreground)] group-hover:text-[var(--color-brand-strong)]" />
            </Link>
          </div>
        </div>
      </section>
    </>
  );
}
