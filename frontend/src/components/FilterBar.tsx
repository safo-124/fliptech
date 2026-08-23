/**
 * Filters, as links rather than a client-side widget.
 *
 * This is the deliberate choice behind the page-weight budget. Rendering the
 * filter row as anchors and a plain GET form means the search page ships no
 * JavaScript at all for its core function: it works on a mid-range Android over
 * 3G, it works with a dropped connection mid-session, and it works before
 * hydration. A React filter component would cost a bundle to do the same job
 * slower on exactly the device this product targets.
 */

import Link from "next/link";

import type { SearchParams } from "@/lib/api";
import { BRAND } from "@/lib/brand";
import type { Trade } from "@/lib/types";

function withParam(current: SearchParams, key: keyof SearchParams, value?: string) {
  const next = new URLSearchParams();
  for (const [k, v] of Object.entries(current)) {
    if (v && k !== "page") next.set(k, v);
  }
  if (value) next.set(key, value);
  else next.delete(key);
  const query = next.toString();
  return query ? `/?${query}` : "/";
}

export function FilterBar({
  trades,
  params,
}: {
  trades: Trade[];
  params: SearchParams;
}) {
  return (
    <div className="border-b border-[var(--color-border)] bg-[var(--color-background)]">
      <nav aria-label="Filter by trade" className="overflow-x-auto">
        <ul className="flex gap-2 px-3 py-2 lg:flex-wrap lg:px-6 lg:py-3">
          <li>
            <Link
              href={withParam(params, "trade", undefined)}
              aria-current={!params.trade ? "page" : undefined}
              className={`tap whitespace-nowrap rounded-full border px-4 text-sm font-medium ${
                !params.trade
                  ? "border-transparent bg-[var(--color-primary)] text-[var(--color-primary-foreground)]"
                  : "border-[var(--color-border)]"
              }`}
            >
              All trades
            </Link>
          </li>
          {trades.map((trade) => {
            const active = params.trade === trade.slug;
            return (
              <li key={trade.slug}>
                <Link
                  href={withParam(params, "trade", trade.slug)}
                  aria-current={active ? "page" : undefined}
                  className={`tap whitespace-nowrap rounded-full border px-4 text-sm font-medium ${
                    active
                      ? "border-transparent bg-[var(--color-primary)] text-[var(--color-primary-foreground)]"
                      : "border-[var(--color-border)]"
                  }`}
                >
                  {trade.name}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      <form
        action="/"
        method="get"
        className="flex flex-wrap items-end gap-2 px-3 pb-3 lg:gap-4 lg:px-6 lg:pb-4"
      >
        {params.trade && <input type="hidden" name="trade" value={params.trade} />}

        <label className="flex-1 text-xs text-[var(--color-muted-foreground)] lg:max-w-sm">
          Search
          <input
            type="search"
            name="q"
            defaultValue={params.q ?? ""}
            placeholder="welder, sewing, plumbing"
            className="tap mt-1 w-full rounded-md border border-[var(--color-input)] bg-[var(--color-background)] px-3 text-base shadow-xs"
          />
        </label>

        <label className="text-xs text-[var(--color-muted-foreground)]">
          Fee up to
          <select
            name="max_fee"
            defaultValue={params.max_fee ?? ""}
            className="tap mt-1 w-full rounded-md border border-[var(--color-input)] bg-[var(--color-background)] px-2 text-base shadow-xs"
          >
            <option value="">Any</option>
            <option value="500">GH₵500</option>
            <option value="1000">GH₵1,000</option>
            <option value="1500">GH₵1,500</option>
            <option value="2500">GH₵2,500</option>
          </select>
        </label>

        <label className="tap gap-2 text-sm">
          <input
            type="checkbox"
            name="verified_only"
            value="true"
            defaultChecked={params.verified_only === "true"}
            className="h-5 w-5"
          />
          Visited by {BRAND}
        </label>

        <button
          type="submit"
          className="tap rounded-md bg-[var(--color-primary)] px-4 text-sm font-medium text-[var(--color-primary-foreground)] shadow-xs"
        >
          Apply
        </button>
      </form>
    </div>
  );
}
