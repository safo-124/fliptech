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

import { FilterBar } from "@/components/FilterBar";
import { ProviderCard } from "@/components/ProviderCard";
import { SearchMapPanel } from "@/components/SearchMapPanel";
import { Badge } from "@/components/ui/badge";
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
      <section className="relative overflow-hidden border-b border-[var(--color-border)]/80">
        <div className="surface-grid pointer-events-none absolute inset-0 opacity-60" aria-hidden="true" />
        <div className="app-shell relative py-7 sm:py-9 lg:py-11">
          <div className="mb-6 max-w-3xl sm:mb-7">
            <Badge
              variant="outline"
              className="border-[var(--color-brand)]/20 bg-[var(--color-brand-soft)] text-[var(--color-brand-strong)]"
            >
              <MapPin aria-hidden="true" />
              Practical training across Greater Accra
            </Badge>
            <h1 className="mt-4 max-w-2xl text-3xl font-bold leading-[1.08] tracking-[-0.035em] sm:text-4xl lg:text-5xl">
              Find training that fits your plans and your pocket.
            </h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-[var(--color-muted-foreground)] sm:text-base sm:leading-7">
              Compare course fees, duration and next intake dates before you spend time or money
              travelling to a workshop.
            </p>
          </div>
          <FilterBar trades={trades.results} params={params} />
        </div>
      </section>

      <section className="app-shell py-6 sm:py-8" aria-labelledby="search-results-heading">
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
