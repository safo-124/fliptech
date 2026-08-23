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

import { FilterBar } from "@/components/FilterBar";
import { ProviderCard } from "@/components/ProviderCard";
import { SearchMapPanel } from "@/components/SearchMapPanel";
import { getTrades, searchProviders, type SearchParams } from "@/lib/api";
import { titleCase } from "@/lib/format";

export const metadata = {
  title: "Find skills training near you in Greater Accra",
};

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

  if (results === null) {
    // Section 10: failed requests retry. api.ts has already retried twice, so
    // this is a genuine outage rather than a dropped packet — say so plainly
    // and keep the filters usable.
    return (
      <div className="p-4">
        <p className="card bg-[var(--color-warn-bg)] p-3 text-sm text-[var(--color-warn)]">
          We could not load providers just now. Check your connection and try again.
        </p>
        <Link href="/" className="tap mt-3 inline-flex underline">
          Try again
        </Link>
      </div>
    );
  }

  return (
    <>
      <FilterBar trades={trades.results} params={params} />

      <div className="flex items-baseline justify-between px-3 pt-3 lg:px-6 lg:pt-5">
        <h1 className="text-sm text-[var(--color-muted-foreground)] lg:text-base">
          {results.count} {results.count === 1 ? "provider" : "providers"}
          {params.trade ? ` for ${titleCase(params.trade).toLowerCase()}` : ""}
        </h1>
      </div>

      {results.count === 0 ? (
        <div className="p-3 lg:px-6">
          <p className="card p-4 text-sm">
            No providers match those filters yet. Try removing the fee limit, or choosing
            &ldquo;All trades&rdquo;.
          </p>
        </div>
      ) : (
        /*
         * Results left, map right, from `lg` upwards. The list keeps the wider
         * column and the ordering — it is still the comparison tool, and the
         * map is a second read of the same results.
         *
         * Column counts step down when the map is beside the list, because the
         * cards have less room: one column at lg, two at xl, three at 2xl.
         */
        <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_28rem] lg:gap-4 lg:px-6 xl:grid-cols-[minmax(0,1fr)_34rem]">
          <ul className="grid grid-cols-1 items-stretch gap-3 p-3 sm:grid-cols-2 lg:grid-cols-1 lg:gap-4 lg:p-0 xl:grid-cols-2 2xl:grid-cols-3">
            {results.results.map((provider) => (
              <li key={provider.id}>
                <ProviderCard provider={provider} />
              </li>
            ))}
          </ul>

          <aside aria-label="Map of these results">
            <div className="lg:sticky lg:top-4">
              <SearchMapPanel providers={results.results} />
            </div>
          </aside>
        </div>
      )}

      <p className="max-w-prose px-3 pb-2 pt-3 text-xs text-[var(--color-muted-foreground)] lg:px-6">
        Enquire with three providers before you decide. Comparing is free and it is the only way
        to know what a fair fee looks like.
      </p>
    </>
  );
}
