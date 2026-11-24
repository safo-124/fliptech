/**
 * The search, as a sentence to finish: "I want to learn [welding] in
 * [Madina], costing [up to GH₵1,500], for [just me]." Then a row of trade
 * tiles in each trade's colour.
 *
 * A sentence because it reads like telling a friend what you are looking for,
 * not like filling in an office form, and because it translates whole: the
 * blanks are tags in one message, so a Twi or Ga sentence can put them in its
 * own order.
 *
 * Still links and a plain GET form, as the filters always were. That is the
 * deliberate choice behind the page-weight budget: the search page ships no
 * JavaScript for its core function, so it works on a mid-range Android over
 * 3G, with a dropped connection, and before hydration. Each blank starts as
 * the phone's own <select> and becomes a searchable list once the script has
 * loaded; the tiles are links.
 */

import Link from "next/link";
import { ArrowRight, Search, X } from "lucide-react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Picker } from "@/components/ui/picker";
import { tradeOptions } from "@/lib/picker-options";
import type { SearchParams } from "@/lib/api";
import { BRAND } from "@/lib/brand";
import { formatFee, titleCase } from "@/lib/format";
import { tradeClass } from "@/lib/trades";
import type { Trade } from "@/lib/types";

/** An area someone can choose in the sentence: one with workshops in it. */
export type AreaChoice = { slug: string; name: string; region?: string; count?: number };

function withParam(current: SearchParams, key: keyof SearchParams, value?: string) {
  const next = new URLSearchParams();
  for (const [k, v] of Object.entries(current)) {
    if (v && k !== "page") next.set(k, v);
  }
  if (value) next.set(key, value);
  else next.delete(key);
  const query = next.toString();
  return query ? `/training?${query}` : "/training";
}

const FORM_FIELDS = new Set<keyof SearchParams>([
  "trade",
  "area",
  "q",
  "max_fee",
  "places",
  "verified_only",
  "page",
]);

const FEES = ["500", "1000", "1500", "2500"];

/**
 * Group sizes for Section 03's NGO programme officer, placing a cohort. A
 * trainee leaves it on "just me". Any other number still works from the URL;
 * these are the sizes worth a tap.
 */
const GROUP_SIZES = ["5", "10", "20", "30"];

/**
 * One blank in the sentence: a dropdown dressed as an underlined word. Before
 * the script loads it is the phone's own <select>; after, a list that can be
 * searched and is grouped (areas under regions, trades under categories).
 */
function Blank({
  label,
  colour,
  ...picker
}: Omit<React.ComponentProps<typeof Picker>, "label" | "selectClassName"> & { label: string; colour?: string }) {
  return (
    <span
      className={`blank ${colour ? `${tradeClass(colour)} text-[var(--trade-fg)]` : "text-[var(--color-brand-strong)]"}`}
    >
      <Picker label={label} {...picker} />
    </span>
  );
}

export function FilterBar({
  trades,
  areas,
  params,
  total,
}: {
  trades: Trade[];
  areas: AreaChoice[];
  params: SearchParams;
  /** How many workshops there are in all, for the "All trades" tile, when known. */
  total: number | null;
}) {
  const t = useTranslations("FilterBar");
  const tFormat = useTranslations("Format");
  const hasFilters = Object.entries(params).some(([key, value]) => key !== "page" && Boolean(value));
  const preservedParams = Object.entries(params).filter(
    ([key, value]) => value && !FORM_FIELDS.has(key as keyof SearchParams),
  );
  const chosenTrade = trades.find((trade) => trade.slug === params.trade);

  return (
    <div>
      <Card className="relative bg-[var(--color-card)] p-4 shadow-[var(--shadow-lg)] sm:p-6">
        {hasFilters ? (
          <Button asChild variant="ghost" size="sm" className="absolute right-2 top-2 min-h-11">
            <Link href="/training">
              <X aria-hidden="true" />
              {t("clearFilters")}
            </Link>
          </Button>
        ) : null}

        <form action="/training" method="get">
          {preservedParams.map(([key, value]) => (
            <input key={key} type="hidden" name={key} value={value} />
          ))}

          <p className={`sentence ${hasFilters ? "pr-20" : ""}`}>
            {t.rich("sentence", {
              trade: () => (
                <Blank
                  name="trade"
                  label={t("tradeLabel")}
                  defaultValue={params.trade ?? ""}
                  colour={chosenTrade?.colour}
                  searchPlaceholder={t("findTrade")}
                  emptyLabel={t("noMatch")}
                  options={[{ value: "", label: t("anyTrade") }, ...tradeOptions(trades)]}
                />
              ),
              area: () => (
                <Blank
                  name="area"
                  label={t("areaLabel")}
                  defaultValue={params.area ?? ""}
                  searchPlaceholder={t("findArea")}
                  emptyLabel={t("noMatch")}
                  options={[
                    { value: "", label: t("anyArea") },
                    // An area reached from elsewhere is kept, so the next
                    // search does not silently drop it.
                    ...(params.area && !areas.some((area) => area.slug === params.area)
                      ? [{ value: params.area, label: titleCase(params.area) }]
                      : []),
                    ...areas.map((area) => ({
                      value: area.slug,
                      label: area.name,
                      group: area.region,
                      hint: area.count ? t("workshopCount", { count: area.count }) : undefined,
                    })),
                  ]}
                />
              ),
              fee: () => (
                <Blank
                  name="max_fee"
                  label={t("maximumFee")}
                  defaultValue={params.max_fee ?? ""}
                  options={[
                    { value: "", label: t("anyAmount") },
                    ...FEES.map((fee) => ({ value: fee, label: t("upTo", { fee: formatFee(fee, tFormat) }) })),
                  ]}
                />
              ),
              places: () => (
                <Blank
                  name="places"
                  label={t("placesNeeded")}
                  defaultValue={params.places ?? ""}
                  options={[
                    { value: "", label: t("justMe") },
                    ...(params.places && !GROUP_SIZES.includes(params.places)
                      ? [{ value: params.places, label: t("groupOf", { size: params.places }) }]
                      : []),
                    ...GROUP_SIZES.map((size) => ({ value: size, label: t("groupOf", { size }) })),
                  ]}
                />
              ),
            })}
          </p>

          <div className="mt-4 grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto_auto] lg:items-center">
            <div className="relative">
              <label htmlFor="provider-search" className="sr-only">
                {t("searchLabel")}
              </label>
              <Search
                className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-[var(--color-muted-foreground)]"
                aria-hidden="true"
              />
              <Input
                id="provider-search"
                type="search"
                name="q"
                defaultValue={params.q ?? ""}
                placeholder={t("searchPlaceholder")}
                className="pl-10"
              />
            </div>
            <label className="flex min-h-11 cursor-pointer items-center gap-2.5 text-sm text-[var(--color-muted-foreground)]">
              <input
                type="checkbox"
                name="verified_only"
                value="true"
                defaultChecked={params.verified_only === "true"}
                className="switch"
              />
              {t("visitedOnly", { brand: BRAND })}
            </label>
            <Button type="submit" variant="brand" size="lg" className="w-full lg:w-auto">
              {t("showWorkshops")}
              <ArrowRight aria-hidden="true" />
            </Button>
          </div>
        </form>
      </Card>

      {/* The trades as tiles. A row to swipe on a phone, a grid from sm. */}
      <nav aria-label={t("filterByTrade")} className="scrollbar-none -mx-3 overflow-x-auto px-3 pt-3 sm:mx-0 sm:overflow-visible sm:px-0">
        <ul className="flex gap-2.5 sm:grid sm:grid-cols-4 lg:grid-cols-[repeat(auto-fit,minmax(8.5rem,1fr))]">
          <li className="w-[7.5rem] shrink-0 sm:w-auto">
            <Link
              href={withParam(params, "trade", undefined)}
              aria-current={!params.trade ? "page" : undefined}
              className={`trade-tile ${tradeClass("violet")}`}
            >
              {t("allTrades")}
              {total !== null ? <small>{t("workshopCount", { count: total })}</small> : null}
            </Link>
          </li>
          {trades.map((trade) => (
            <li key={trade.slug} className="w-[7.5rem] shrink-0 sm:w-auto">
              <Link
                href={withParam(params, "trade", trade.slug)}
                aria-current={params.trade === trade.slug ? "page" : undefined}
                className={`trade-tile ${tradeClass(trade.colour)}`}
              >
                {trade.name}
                <small>{t("workshopCount", { count: trade.provider_count })}</small>
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    </div>
  );
}
