import { SlidersHorizontal, X } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";

import type { MarketplaceParams } from "@/lib/api";

/**
 * The marketplace's filters, as plain form fields inside the page's GET
 * form, so they work with JavaScript off like the rest of the search.
 *
 * Folded away in a <details> until opened; it opens by itself when a filter
 * is on, so a buyer can see and change what is narrowing the list.
 */

/** Switches that are on with "1", in the order shown. */
const SWITCHES = [
  ["pay_online", "filterPayOnline"],
  ["delivers", "filterDelivers"],
  ["verified", "filterVerified"],
  ["on_sale", "filterOnSale"],
] as const;

/** The parameters these filters own, for counting and clearing them. */
export const FILTER_KEYS = [
  "sold_by",
  "condition",
  "min_rating",
  "min_price",
  "max_price",
  "availability",
  ...SWITCHES.map(([key]) => key),
] as const;

export function activeFilterCount(params: MarketplaceParams) {
  return FILTER_KEYS.filter((key) => params[key]).length;
}

export function MarketFilters({ params }: { params: MarketplaceParams }) {
  const t = useTranslations("Marketplace");
  const count = activeFilterCount(params);
  const soldBy = params.sold_by ?? "";

  return (
    <details
      open={count > 0}
      className="group mt-3 rounded-2xl bg-[var(--color-card)] text-[var(--color-foreground)] shadow-[var(--shadow-lg)]"
    >
      <summary className="flex min-h-12 cursor-pointer list-none items-center gap-2 px-4 text-sm font-bold [&::-webkit-details-marker]:hidden">
        <SlidersHorizontal aria-hidden="true" className="size-4 text-[var(--color-brand)]" />
        {t("filtersTitle")}
        {count ? (
          <span className="rounded-full bg-[var(--color-brand)] px-2 py-0.5 text-[11px] font-extrabold text-white">
            {t("filtersActive", { count })}
          </span>
        ) : null}
        <span aria-hidden="true" className="ml-auto text-[var(--color-muted-foreground)] transition group-open:rotate-180">
          ▾
        </span>
      </summary>

      <div className="grid gap-5 border-t border-[var(--color-border)] px-4 py-4 sm:grid-cols-2 lg:grid-cols-4">
        <fieldset>
          <legend className="text-xs font-extrabold uppercase tracking-[0.08em] text-[var(--color-muted-foreground)]">
            {t("soldByLabel")}
          </legend>
          <div className="mt-2 flex flex-col gap-1.5">
            {(
              [
                ["", "soldByAnyone"],
                ["trainers", "soldByTrainers"],
                ["makers", "soldByMakers"],
              ] as const
            ).map(([value, label]) => (
              <label key={label} className="flex min-h-9 cursor-pointer items-center gap-2.5 text-sm">
                <input
                  type="radio"
                  name="sold_by"
                  value={value}
                  defaultChecked={soldBy === value}
                  className="size-4 accent-[var(--color-brand)]"
                />
                {t(label)}
              </label>
            ))}
          </div>
        </fieldset>

        <fieldset>
          <legend className="text-xs font-extrabold uppercase tracking-[0.08em] text-[var(--color-muted-foreground)]">
            {t("conditionLabel")}
          </legend>
          <div className="mt-2 flex flex-col gap-1.5">
            {(
              [
                ["", "conditionAny"],
                ["new", "conditionNew"],
                ["used", "conditionUsedOnly"],
              ] as const
            ).map(([value, label]) => (
              <label key={label} className="flex min-h-9 cursor-pointer items-center gap-2.5 text-sm">
                <input
                  type="radio"
                  name="condition"
                  value={value}
                  defaultChecked={(params.condition ?? "") === value}
                  className="size-4 accent-[var(--color-brand)]"
                />
                {t(label)}
              </label>
            ))}
          </div>
        </fieldset>

        <fieldset>
          <legend className="text-xs font-extrabold uppercase tracking-[0.08em] text-[var(--color-muted-foreground)]">
            {t("priceLabel")}
          </legend>
          <div className="mt-2 flex items-center gap-2">
            <label className="sr-only" htmlFor="market-min">
              {t("minPrice")}
            </label>
            <input
              id="market-min"
              name="min_price"
              type="number"
              inputMode="numeric"
              min={0}
              step="any"
              defaultValue={params.min_price ?? ""}
              placeholder={t("minPrice")}
              className="h-11 w-full min-w-0 rounded-xl border border-[var(--color-border)] bg-[var(--color-muted)] px-3 text-sm outline-none focus:border-[var(--color-brand)]"
            />
            <span aria-hidden="true" className="text-[var(--color-muted-foreground)]">
              –
            </span>
            <label className="sr-only" htmlFor="market-max">
              {t("maxPrice")}
            </label>
            <input
              id="market-max"
              name="max_price"
              type="number"
              inputMode="numeric"
              min={0}
              step="any"
              defaultValue={params.max_price ?? ""}
              placeholder={t("maxPrice")}
              className="h-11 w-full min-w-0 rounded-xl border border-[var(--color-border)] bg-[var(--color-muted)] px-3 text-sm outline-none focus:border-[var(--color-brand)]"
            />
          </div>
        </fieldset>

        <fieldset>
          <legend className="text-xs font-extrabold uppercase tracking-[0.08em] text-[var(--color-muted-foreground)]">
            {t("showOnly")}
          </legend>
          <div className="mt-2 flex flex-col gap-1.5">
            {SWITCHES.map(([key, label]) => (
              <label key={key} className="flex min-h-9 cursor-pointer items-center gap-2.5 text-sm">
                <input
                  type="checkbox"
                  name={key}
                  value="1"
                  defaultChecked={Boolean(params[key])}
                  className="size-4 accent-[var(--color-brand)]"
                />
                {t(label)}
              </label>
            ))}
            <label className="flex min-h-9 cursor-pointer items-center gap-2.5 text-sm">
              <input
                type="checkbox"
                name="min_rating"
                value="4"
                defaultChecked={Boolean(params.min_rating)}
                className="size-4 accent-[var(--color-brand)]"
              />
              {t("filterRating")}
            </label>
            <label className="flex min-h-9 cursor-pointer items-center gap-2.5 text-sm">
              <input
                type="checkbox"
                name="availability"
                value="available"
                defaultChecked={params.availability === "available"}
                className="size-4 accent-[var(--color-brand)]"
              />
              {t("filterInStock")}
            </label>
          </div>
        </fieldset>

        <div className="sm:col-span-2 lg:col-span-4">
          <button
            type="submit"
            className="h-11 w-full rounded-full bg-[var(--color-brand)] px-6 text-sm font-bold text-white sm:w-auto"
          >
            {t("applyFilters")}
          </button>
        </div>
      </div>
    </details>
  );
}

/** A link to this page with some parameters changed (undefined removes one). */
export function marketHref(params: MarketplaceParams, change: Partial<Record<keyof MarketplaceParams, string | undefined>>) {
  const next = new URLSearchParams();
  for (const [key, value] of Object.entries({ ...params, ...change })) {
    if (value) next.set(key, value);
  }
  const query = next.toString();
  return query ? `/marketplace?${query}` : "/marketplace";
}

/** What is on, as chips that each take one filter off. */
export function ActiveFilterChips({ params }: { params: MarketplaceParams }) {
  const t = useTranslations("Marketplace");
  const chips: { label: string; change: Partial<Record<keyof MarketplaceParams, undefined>> }[] = [];
  if (params.sold_by === "trainers") chips.push({ label: t("soldByTrainers"), change: { sold_by: undefined } });
  if (params.sold_by === "makers") chips.push({ label: t("soldByMakers"), change: { sold_by: undefined } });
  if (params.min_price && params.max_price) {
    chips.push({
      label: t("chipPrice", { low: params.min_price, high: params.max_price }),
      change: { min_price: undefined, max_price: undefined },
    });
  } else if (params.min_price) {
    chips.push({ label: t("chipFrom", { low: params.min_price }), change: { min_price: undefined } });
  } else if (params.max_price) {
    chips.push({ label: t("chipUpTo", { high: params.max_price }), change: { max_price: undefined } });
  }
  for (const [key, label] of SWITCHES) {
    if (params[key]) chips.push({ label: t(label), change: { [key]: undefined } });
  }
  if (params.availability === "available") chips.push({ label: t("filterInStock"), change: { availability: undefined } });
  if (params.condition === "used") chips.push({ label: t("conditionUsedOnly"), change: { condition: undefined } });
  if (params.condition === "new") chips.push({ label: t("conditionNew"), change: { condition: undefined } });
  if (params.min_rating) chips.push({ label: t("filterRating"), change: { min_rating: undefined } });
  if (!chips.length) return null;

  return (
    <ul className="mb-4 flex flex-wrap gap-2">
      {chips.map((chip) => (
        <li key={chip.label}>
          <Link
            href={marketHref(params, { ...chip.change, page: undefined })}
            aria-label={t("removeFilter", { name: chip.label })}
            className="inline-flex min-h-9 items-center gap-1.5 rounded-full border border-[var(--color-brand)]/30 bg-[var(--color-brand-soft,var(--color-muted))] px-3 text-xs font-bold text-[var(--color-brand)]"
          >
            {chip.label}
            <X aria-hidden="true" className="size-3.5" />
          </Link>
        </li>
      ))}
    </ul>
  );
}
