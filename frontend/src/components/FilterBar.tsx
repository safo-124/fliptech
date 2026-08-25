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
import { Check, Search, SlidersHorizontal, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Separator } from "@/components/ui/separator";
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

const FORM_FIELDS = new Set<keyof SearchParams>([
  "trade",
  "q",
  "max_fee",
  "verified_only",
  "page",
]);

export function FilterBar({
  trades,
  params,
}: {
  trades: Trade[];
  params: SearchParams;
}) {
  const hasFilters = Object.entries(params).some(([key, value]) => key !== "page" && Boolean(value));
  const preservedParams = Object.entries(params).filter(
    ([key, value]) => value && !FORM_FIELDS.has(key as keyof SearchParams),
  );

  return (
    <Card className="overflow-hidden bg-[var(--color-card)]/95 shadow-[var(--shadow-lg)]">
      <div className="flex items-center justify-between gap-4 px-4 pb-3 pt-4 sm:px-5 sm:pt-5">
        <div className="flex min-w-0 items-center gap-2 text-xs font-semibold uppercase tracking-[0.12em] text-[var(--color-muted-foreground)]">
          <SlidersHorizontal className="size-3.5 shrink-0" aria-hidden="true" />
          <span>Choose a trade</span>
        </div>
        {hasFilters ? (
          <Button asChild variant="ghost" size="sm" className="min-h-11 shrink-0">
            <Link href="/">
              <X aria-hidden="true" />
              Clear filters
            </Link>
          </Button>
        ) : null}
      </div>

      <nav aria-label="Filter by trade" className="scrollbar-none overflow-x-auto px-4 pb-4 sm:px-5">
        <ul className="flex min-w-max gap-2">
          <li>
            <Button
              asChild
              variant={!params.trade ? "default" : "secondary"}
              className="rounded-full px-4"
            >
              <Link
                href={withParam(params, "trade", undefined)}
                aria-current={!params.trade ? "page" : undefined}
              >
                All trades
              </Link>
            </Button>
          </li>
          {trades.map((trade) => {
            const active = params.trade === trade.slug;
            return (
              <li key={trade.slug}>
                <Button
                  asChild
                  variant={active ? "default" : "secondary"}
                  className="rounded-full px-4"
                >
                  <Link
                    href={withParam(params, "trade", trade.slug)}
                    aria-current={active ? "page" : undefined}
                  >
                    {trade.name}
                  </Link>
                </Button>
              </li>
            );
          })}
        </ul>
      </nav>

      <Separator />

      <form
        action="/"
        method="get"
        className="grid gap-3 p-4 sm:grid-cols-2 sm:p-5 lg:grid-cols-[minmax(16rem,1fr)_12rem_minmax(13rem,auto)_auto] lg:items-end"
      >
        {params.trade && <input type="hidden" name="trade" value={params.trade} />}
        {preservedParams.map(([key, value]) => (
          <input key={key} type="hidden" name={key} value={value} />
        ))}

        <div className="sm:col-span-2 lg:col-span-1">
          <Label htmlFor="provider-search">Search providers or skills</Label>
          <div className="relative mt-2">
            <Search
              className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-[var(--color-muted-foreground)]"
              aria-hidden="true"
            />
            <Input
              id="provider-search"
              type="search"
              name="q"
              defaultValue={params.q ?? ""}
              placeholder="Try welding, sewing or plumbing"
              className="pl-10"
            />
          </div>
        </div>

        <div>
          <Label htmlFor="maximum-fee">Maximum fee</Label>
          <div className="mt-2">
            <NativeSelect
              id="maximum-fee"
              name="max_fee"
              defaultValue={params.max_fee ?? ""}
            >
              <option value="">Any fee</option>
              <option value="500">GH₵500</option>
              <option value="1000">GH₵1,000</option>
              <option value="1500">GH₵1,500</option>
              <option value="2500">GH₵2,500</option>
            </NativeSelect>
          </div>
        </div>

        <Label className="mt-auto flex h-12 cursor-pointer items-center gap-3 rounded-xl border border-[var(--color-input)] bg-[var(--color-card)] px-3.5 shadow-xs transition-colors hover:border-[var(--color-border-strong)] hover:bg-[var(--color-muted)]/45">
          <span className="relative grid size-5 shrink-0 place-items-center">
            <input
              type="checkbox"
              name="verified_only"
              value="true"
              defaultChecked={params.verified_only === "true"}
              className="peer size-5 appearance-none rounded-md border border-[var(--color-border-strong)] bg-white checked:border-[var(--color-brand)] checked:bg-[var(--color-brand)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)]"
            />
            <Check
              className="pointer-events-none absolute size-3.5 text-white opacity-0 peer-checked:opacity-100"
              strokeWidth={3}
              aria-hidden="true"
            />
          </span>
          <span className="min-w-0 leading-tight">
            <span className="block text-sm font-semibold">Visited by {BRAND}</span>
            <span className="mt-0.5 block text-[10px] font-normal text-[var(--color-muted-foreground)]">
              A {BRAND} site check
            </span>
          </span>
        </Label>

        <Button type="submit" variant="brand" size="lg" className="w-full lg:w-auto">
          Show providers
          <Search aria-hidden="true" />
        </Button>
      </form>
    </Card>
  );
}
