/**
 * The marketplace: what the workshops on this site make.
 *
 * A Server Component with a plain GET form, like the training search, so
 * browsing and filtering work with no JavaScript. The only client code on
 * the page is the Ask button on a product, and that lives one page deeper.
 *
 * Not a cart. A buyer asks the maker, or pays for one thing with "Buy now"
 * on its page when the seller takes payment on the site. Boosted products
 * come first unless the buyer chose a sort, and say "Sponsored".
 */

import { PackageSearch, Search, Store } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";

import { KindTiles } from "@/components/marketplace/KindTiles";
import {
  ActiveFilterChips,
  activeFilterCount,
  marketHref,
  MoreSheet,
} from "@/components/marketplace/MarketFilters";
import { QuickChips } from "@/components/marketplace/QuickChips";
import { ProductTile } from "@/components/marketplace/ProductTile";
import { RecentlyViewed } from "@/components/marketplace/RecentlyViewed";
import { SaveSearch } from "@/components/marketplace/SaveSearch";
import { MarketViewSwitch } from "@/components/marketplace/MarketViewSwitch";
import { ShopsRow } from "@/components/marketplace/ShopsRow";
import { ClientMessages } from "@/i18n/ClientMessages";
import { MARKETPLACE_CLIENT_NAMESPACES } from "@/i18n/namespaces";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Picker } from "@/components/ui/picker";
import { bandPrices } from "@/lib/market-kinds";
import { areaOptions } from "@/lib/picker-options";
import { CategoryPill } from "@/components/CategoryPill";
import {
  buildQuery,
  getAllRegions,
  getShops,
  getTradeCategory,
  searchProducts,
  type MarketplaceParams,
} from "@/lib/api";
import { BRAND } from "@/lib/brand";

export const revalidate = 300;

/** The API's page size (REST_FRAMEWORK PAGE_SIZE). */
const PAGE_SIZE = 20;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Marketplace");
  return {
    title: t("metaTitle"),
    description: t("metaDescription", { brand: BRAND }),
    // Filtered views point at the plain marketplace; products have their own pages.
    alternates: { canonical: "/marketplace" },
  };
}

export default async function MarketplacePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const raw = await searchParams;
  const given: MarketplaceParams = Object.fromEntries(
    Object.entries(raw).map(([key, value]) => [key, Array.isArray(value) ? value[0] : value]),
  );
  // "How much?" sends a band; the API and every link after this read the
  // lowest and highest price it stands for.
  const { price_band: band, ...rest } = given;
  const params: MarketplaceParams =
    band !== undefined ? { ...rest, min_price: undefined, max_price: undefined, ...(bandPrices(band) ?? {}) } : given;

  const filterCount = activeFilterCount(params);
  const filtered = Boolean(
    params.trade || params.category || params.area || params.q || params.kind || params.condition || filterCount,
  );
  // Opened from a category page (?category=): named, with a way to undo it.
  const [chosenCategory, tCategory] = await Promise.all([
    params.category ? getTradeCategory(params.category).catch(() => null) : null,
    getTranslations("CategoryFilter"),
  ]);
  const page = Math.max(1, Number.parseInt(params.page ?? "1", 10) || 1);

  const [products, regions, shops, t, payable] = await Promise.all([
    searchProducts(params).catch(() => null),
    getAllRegions().catch(() => []),
    // The Shops row (trainers' shops first), on the plain first page only.
    filtered || page > 1 ? null : getShops(12).catch(() => null),
    getTranslations("Marketplace"),
    // "Pay on Fliiptech" is only offered as a filter when something can be
    // paid that way; otherwise it would always lead to an empty page.
    searchProducts({ pay_online: "1" })
      .then((found) => found.count > 0)
      .catch(() => false),
  ]);

  const results = products?.results ?? [];
  const pages = products ? Math.max(1, Math.ceil(products.count / PAGE_SIZE)) : 1;
  // A sort and a place change the order, not what matches, so they keep the
  // "nothing yet" wording; only the filters above make it "nothing matches".

  return (
    <div className="pb-14">
      {/* A GET form, so searching and every filter work with the JavaScript
          turned off, like the training search. */}
      <form action="/marketplace" method="get" className="app-shell pt-6 sm:pt-8">
        <section className="relative isolate overflow-hidden rounded-3xl border border-[var(--color-border)] bg-[radial-gradient(120%_140%_at_0%_0%,var(--color-brand-soft),var(--color-background)_60%)] p-5 sm:p-8">
          <p className="text-sm font-medium text-[var(--color-muted-foreground)]">{t("heroEyebrow")}</p>
          <h1 className="mt-1.5 text-[1.75rem] font-bold leading-tight tracking-[-0.025em] text-[var(--color-brand-deep)] sm:text-4xl">
            {t("heroTitle")}
          </h1>
          <div className="mt-5 flex max-w-2xl items-center gap-2 rounded-2xl border-[1.5px] border-[var(--color-border-strong)] bg-[var(--color-card)] p-1.5 pl-4 focus-within:border-[var(--color-brand)]">
            <Search aria-hidden="true" className="size-5 shrink-0 text-[var(--color-muted-foreground)]" />
            <label htmlFor="market-q" className="sr-only">
              {t("searchLabel")}
            </label>
            <input
              id="market-q"
              name="q"
              type="search"
              defaultValue={params.q ?? ""}
              placeholder={t("searchPlaceholder")}
              className="h-12 w-full min-w-0 border-0 bg-transparent text-base text-[var(--color-foreground)] outline-none placeholder:text-[var(--color-muted-foreground)] sm:text-lg"
            />
            <Button type="submit" variant="brand" size="lg" className="shrink-0 rounded-xl" aria-label={t("searchAction")}>
              <Search aria-hidden="true" className="sm:hidden" />
              <span className="hidden sm:inline">{t("searchAction")}</span>
            </Button>
          </div>
          {/* Kept through a new search: the picture, "near me" and new or used
              are set by the buttons below, not by fields in this form. */}
          {params.kind ? <input type="hidden" name="kind" value={params.kind} /> : null}
          {params.near ? <input type="hidden" name="near" value={params.near} /> : null}
          {params.condition ? <input type="hidden" name="condition" value={params.condition} /> : null}
          <p className="mt-4 flex flex-wrap gap-x-4 gap-y-1.5 text-sm">
            <Link href="/marketplace/saved" className="font-semibold text-[var(--color-brand)] underline-offset-4 hover:underline">
              {t("savedLink")}
            </Link>
            <Link href="/marketplace/quote" className="font-semibold text-[var(--color-brand)] underline-offset-4 hover:underline">
              {t("quoteCta")}
            </Link>
            <Link href="/sell" className="font-semibold text-[var(--color-brand)] underline-offset-4 hover:underline">
              {t("sellYours")}
            </Link>
          </p>
        </section>

        <KindTiles params={params} />

        <QuickChips
          params={params}
          more={
            <MoreSheet
              params={params}
              payOnlineAvailable={payable}
              where={
                <Picker
                  id="market-area"
                  name="area"
                  label={t("areaLabel")}
                  defaultValue={params.area ?? ""}
                  searchPlaceholder={t("findArea")}
                  emptyLabel={t("noMatch")}
                  options={[{ value: "", label: t("anyArea") }, ...areaOptions(regions)]}
                  className="w-full"
                  triggerClassName="h-11 w-full text-[0.9375rem] text-[var(--color-foreground)] outline-none"
                  selectClassName="h-11 w-full border-0 bg-transparent text-[0.9375rem] text-[var(--color-foreground)] outline-none"
                />
              }
            />
          }
        />
      </form>

      <section className="app-shell mt-6">
        <MarketViewSwitch current="items" />
        <ShopsRow shops={shops?.results ?? []} />
        <div className="mb-1 flex flex-wrap items-start justify-between gap-3">
          <ActiveFilterChips params={params} />
          {filtered && results.length ? (
            <ClientMessages namespaces={MARKETPLACE_CLIENT_NAMESPACES}>
              <SaveSearch params={params} label={params.q || t("title")} />
            </ClientMessages>
          ) : null}
        </div>
        {products === null ? (
          <Card className="p-8 text-center">
            <p className="text-sm text-[var(--color-muted-foreground)]">{t("unavailable")}</p>
          </Card>
        ) : results.length === 0 ? (
          <Card className="p-8 text-center sm:p-12">
            <span className="mx-auto grid size-20 place-items-center rounded-full bg-[var(--color-brand-soft)] text-[var(--color-brand)]">
              <PackageSearch aria-hidden="true" className="size-9" />
            </span>
            <h2 className="mt-4 text-xl font-bold tracking-[-0.02em] text-[var(--color-brand-deep)]">
              {filtered ? t("emptyTitle") : t("noneYet")}
            </h2>
            <p className="mx-auto mt-2 max-w-[44ch] text-base leading-relaxed text-[var(--color-muted-foreground)]">
              {filtered ? t("emptyBody") : t("noneYetBody")}
            </p>
            {filtered ? (
              <div className="mx-auto mt-6 flex max-w-sm flex-col gap-2.5">
                <Button asChild variant="brand" size="lg">
                  <Link href="/marketplace">{t("seeEverything")}</Link>
                </Button>
                <ClientMessages namespaces={MARKETPLACE_CLIENT_NAMESPACES}>
                  <SaveSearch params={params} label={params.q || t("title")} />
                </ClientMessages>
              </div>
            ) : (
              <Button asChild variant="brand" size="lg" className="mt-6">
                <Link href="/sell">
                  <Store aria-hidden="true" />
                  {t("sellHere")}
                </Link>
              </Button>
            )}
          </Card>
        ) : (
          <>
            <p className="mb-4 text-base text-[var(--color-muted-foreground)]">
              <strong className="font-semibold text-[var(--color-foreground)]">{t("countThings", { count: products.count })}</strong>
              {params.near ? ` ${t("nearYou")}` : ""}
            </p>
            {chosenCategory ? (
              <div className="-mt-2 mb-4">
                <CategoryPill
                  label={tCategory("showing", { category: chosenCategory.name })}
                  clearLabel={tCategory("clear")}
                  href={`/marketplace${buildQuery({ ...params, category: undefined, page: undefined })}`}
                />
              </div>
            ) : null}
            <div className="grid grid-cols-2 gap-3.5 sm:gap-4 lg:grid-cols-4">
              {results.map((product) => (
                <ProductTile key={product.id} product={product} />
              ))}
            </div>
            {pages > 1 ? (
              <nav
                aria-label={t("pageOf", { page, pages })}
                className="mt-8 flex items-center justify-between gap-3"
              >
                {page > 1 ? (
                  <Button asChild variant="outline">
                    <Link href={marketHref(params, { page: page > 2 ? String(page - 1) : undefined })} rel="prev">
                      {t("pagePrevious")}
                    </Link>
                  </Button>
                ) : (
                  <span />
                )}
                <p className="text-sm text-[var(--color-muted-foreground)]">{t("pageOf", { page, pages })}</p>
                {products.next ? (
                  <Button asChild variant="outline">
                    <Link href={marketHref(params, { page: String(page + 1) })} rel="next">
                      {t("pageNext")}
                    </Link>
                  </Button>
                ) : (
                  <span />
                )}
              </nav>
            ) : null}
          </>
        )}
        <ClientMessages namespaces={MARKETPLACE_CLIENT_NAMESPACES}>
          <RecentlyViewed title={t("recentlyViewed")} />
        </ClientMessages>
      </section>
    </div>
  );
}
