import { SlidersHorizontal, X } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";

import type { MarketplaceParams } from "@/lib/api";
import { bandFor, isMarketKind, PRICE_BANDS } from "@/lib/market-kinds";

/**
 * The marketplace's filters, as plain form fields inside the page's GET
 * form, so they work with JavaScript off like the rest of the search: the
 * "More" sheet, the chips that show what is on, and links that change one
 * thing at a time.
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

/** One choice in the More sheet: a big tap-target that looks like a button
    and is a real radio or checkbox underneath, so the form still works with
    JavaScript off. */
function Choice({
  type,
  name,
  value,
  checked,
  children,
}: {
  type: "radio" | "checkbox";
  name: string;
  value: string;
  checked: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-full border border-[var(--color-border)] bg-[var(--color-card)] px-4 text-[0.9375rem] font-medium transition-colors has-[:checked]:border-[var(--color-brand)] has-[:checked]:bg-[var(--color-brand)] has-[:checked]:text-white has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-[var(--color-brand)]/40">
      <input type={type} name={name} value={value} defaultChecked={checked} className="sr-only" />
      {children}
    </label>
  );
}

function Question({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <fieldset className="mt-5 first:mt-0">
      <legend className="text-base font-semibold text-[var(--color-brand-deep)]">{title}</legend>
      <div className="mt-2.5 flex flex-wrap gap-2">{children}</div>
    </fieldset>
  );
}

/**
 * "More": everything besides the quick buttons, as one sheet of big choices.
 * A <details> inside the page's GET form, so it opens and submits with
 * JavaScript off. A bottom sheet on a phone (the dimmed page behind closes
 * it), a panel under the buttons on a wider screen.
 */
export function MoreSheet({
  params,
  payOnlineAvailable = true,
  where,
}: {
  params: MarketplaceParams;
  /** Some product can be paid on the site: only then is the switch shown. */
  payOnlineAvailable?: boolean;
  /** The "Where?" place picker, made by the page. */
  where: React.ReactNode;
}) {
  const t = useTranslations("Marketplace");
  // What is on inside this sheet: new or used is a quick button outside it.
  const count = activeFilterCount({ ...params, condition: undefined });
  const soldBy = params.sold_by ?? "";
  const band = bandFor(params.min_price, params.max_price);
  const sort = params.sort ?? "";

  return (
    <details className="group">
      <summary className="inline-flex min-h-11 cursor-pointer list-none items-center gap-2 rounded-full border border-[var(--color-border)] bg-[var(--color-card)] px-4 text-[0.9375rem] font-medium before:pointer-events-none group-open:border-[var(--color-brand)] group-open:before:pointer-events-auto group-open:before:fixed group-open:before:inset-0 group-open:before:z-[1090] group-open:before:bg-black/35 group-open:before:content-[''] sm:group-open:before:bg-transparent [&::-webkit-details-marker]:hidden">
        <SlidersHorizontal aria-hidden="true" className="size-4 text-[var(--color-brand)]" />
        {t("moreChoices")}
        {count ? (
          <span className="rounded-full bg-[var(--color-brand)] px-2 py-0.5 text-xs font-semibold text-white">{count}</span>
        ) : null}
      </summary>

      <div className="fixed inset-x-0 bottom-0 z-[1100] max-h-[85dvh] overflow-y-auto rounded-t-3xl border border-[var(--color-border)] bg-[var(--color-card)] p-5 pb-8 text-[var(--color-foreground)] shadow-[var(--shadow-lg)] sm:absolute sm:inset-x-0 sm:bottom-auto sm:top-full sm:mt-2 sm:max-h-none sm:rounded-2xl sm:pb-5">
        <div aria-hidden="true" className="mx-auto mb-3 h-1.5 w-10 rounded-full bg-[var(--color-border-strong)] sm:hidden" />
        <p className="text-lg font-bold text-[var(--color-brand-deep)]">{t("moreTitle")}</p>

        <div className="mt-4 grid gap-x-8 lg:grid-cols-2">
          <div>
            <Question title={t("whoMadeIt")}>
              <Choice type="radio" name="sold_by" value="" checked={soldBy === ""}>
                {t("soldByAnyone")}
              </Choice>
              <Choice type="radio" name="sold_by" value="trainers" checked={soldBy === "trainers"}>
                {t("whoWorkshop")}
              </Choice>
              <Choice type="radio" name="sold_by" value="makers" checked={soldBy === "makers"}>
                {t("whoMaker")}
              </Choice>
            </Question>

            <Question title={t("howMuch")}>
              <Choice type="radio" name="price_band" value="" checked={band === "" && !params.min_price && !params.max_price}>
                {t("anyPrice")}
              </Choice>
              {PRICE_BANDS.map((option) => (
                <Choice key={option.value} type="radio" name="price_band" value={option.value} checked={band === option.value}>
                  {t(`band.${option.value}`)}
                </Choice>
              ))}
            </Question>

            <fieldset className="mt-5">
              <legend className="text-base font-semibold text-[var(--color-brand-deep)]">{t("whereQuestion")}</legend>
              <div className="mt-2.5 max-w-sm rounded-xl border border-[var(--color-border)] px-3">{where}</div>
            </fieldset>
          </div>

          <div>
            <Question title={t("showOnly")}>
              {SWITCHES.filter(([key]) => key !== "pay_online" || payOnlineAvailable || params.pay_online).map(([key, label]) => (
                <Choice key={key} type="checkbox" name={key} value="1" checked={Boolean(params[key])}>
                  {t(label)}
                </Choice>
              ))}
              <Choice type="checkbox" name="min_rating" value="4" checked={Boolean(params.min_rating)}>
                {t("filterRating")}
              </Choice>
              <Choice type="checkbox" name="availability" value="available" checked={params.availability === "available"}>
                {t("filterInStock")}
              </Choice>
            </Question>

            <Question title={t("showFirst")}>
              {(
                [
                  ["", "sortBest"],
                  ["price", "chipCheapest"],
                  ["-price", "sortPriceHigh"],
                  ["newest", "sortNewest"],
                  ["rating", "sortRating"],
                  ...(params.near ? ([["nearest", "sortNearest"]] as const) : []),
                ] as const
              ).map(([value, label]) => (
                <Choice key={label} type="radio" name="sort" value={value} checked={sort === value}>
                  {t(label)}
                </Choice>
              ))}
            </Question>
          </div>
        </div>

        <div className="mt-6 flex gap-2.5">
          <Link
            href={marketHref({ q: params.q, kind: params.kind, near: params.near }, {})}
            className="inline-flex min-h-12 flex-1 items-center justify-center rounded-xl border border-[var(--color-border-strong)] px-4 font-semibold"
          >
            {t("moreClear")}
          </Link>
          <button
            type="submit"
            className="inline-flex min-h-12 flex-[2] items-center justify-center rounded-xl bg-[var(--color-brand)] px-6 font-semibold text-white"
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
  if (isMarketKind(params.kind)) chips.push({ label: t(`kind.${params.kind}`), change: { kind: undefined } });
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
