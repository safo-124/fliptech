/**
 * The marketplace: what the workshops on this site make.
 *
 * A Server Component with a plain GET form, like the training search, so
 * browsing and filtering work with no JavaScript. The only client code on
 * the page is the Ask button on a product, and that lives one page deeper.
 *
 * Deliberately not a cart. Money passes between buyer and seller as it does
 * in a market today; what passes through here is the asking, because a
 * marketplace you cannot measure is one you cannot decide anything about.
 */

import { PackageSearch, Search, Store } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";

import { BrandShards } from "@/components/BrandShards";
import { ProductTile } from "@/components/marketplace/ProductTile";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { getAllAreas, getAllTrades, searchProducts, type MarketplaceParams } from "@/lib/api";
import { BRAND } from "@/lib/brand";

export const revalidate = 300;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Marketplace");
  return {
    title: t("metaTitle"),
    description: t("metaDescription", { brand: BRAND }),
  };
}

export default async function MarketplacePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const raw = await searchParams;
  const params: MarketplaceParams = Object.fromEntries(
    Object.entries(raw).map(([key, value]) => [key, Array.isArray(value) ? value[0] : value]),
  );

  const [products, trades, areas, t] = await Promise.all([
    searchProducts(params).catch(() => null),
    getAllTrades().catch(() => []),
    getAllAreas().catch(() => []),
    getTranslations("Marketplace"),
  ]);

  const results = products?.results ?? [];
  const filtered = Boolean(params.trade || params.area || params.q);

  return (
    <div className="pb-14">
      <section className="band relative isolate overflow-hidden">
        <BrandShards className="pointer-events-none absolute -right-8 -top-12 h-[16rem] w-[22rem] opacity-25" />
        <div className="app-shell relative z-10 py-8 sm:py-12">
          <p className="text-[11px] font-extrabold uppercase tracking-[0.17em] text-[var(--color-peach)]">
            {t("eyebrow")}
          </p>
          <h1 className="mt-2 max-w-[20ch] text-[1.75rem] font-extrabold leading-[1.12] tracking-[-0.035em] text-white sm:text-4xl">
            {t("title")}
          </h1>
          <p className="mt-3 max-w-[56ch] text-sm leading-relaxed text-white/75 sm:text-base">
            {t("intro")}
          </p>

          {/* A GET form. Filtering is the core function of this page and it
              works with the JavaScript turned off. */}
          <form action="/marketplace" method="get" className="mt-6 max-w-3xl">
            <div className="rounded-2xl bg-[var(--color-card)] p-2.5 shadow-[var(--shadow-lg)] sm:flex sm:items-center sm:gap-2 sm:p-3">
              <div className="flex flex-1 items-center gap-2.5 rounded-xl bg-[var(--color-muted)] px-3 sm:bg-transparent sm:px-2">
                <Search aria-hidden="true" className="size-4 shrink-0 text-[var(--color-muted-foreground)]" />
                <label htmlFor="market-q" className="sr-only">
                  {t("searchLabel")}
                </label>
                <input
                  id="market-q"
                  name="q"
                  type="search"
                  defaultValue={params.q ?? ""}
                  placeholder={t("searchPlaceholder")}
                  className="h-11 w-full min-w-0 border-0 bg-transparent text-sm text-[var(--color-foreground)] outline-none placeholder:text-[var(--color-muted-foreground)]"
                />
              </div>

              <div className="mt-2 grid grid-cols-2 gap-2 sm:mt-0 sm:flex sm:items-center">
                <div className="rounded-xl bg-[var(--color-muted)] px-3 sm:bg-transparent">
                  <label htmlFor="market-trade" className="sr-only">
                    {t("tradeLabel")}
                  </label>
                  <select
                    id="market-trade"
                    name="trade"
                    defaultValue={params.trade ?? ""}
                    className="h-11 w-full border-0 bg-transparent text-sm outline-none"
                  >
                    <option value="">{t("anyTrade")}</option>
                    {trades.map((trade) => (
                      <option key={trade.slug} value={trade.slug}>
                        {trade.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="rounded-xl bg-[var(--color-muted)] px-3 sm:bg-transparent sm:border-l sm:border-[var(--color-border)]">
                  <label htmlFor="market-area" className="sr-only">
                    {t("areaLabel")}
                  </label>
                  <select
                    id="market-area"
                    name="area"
                    defaultValue={params.area ?? ""}
                    className="h-11 w-full border-0 bg-transparent text-sm outline-none"
                  >
                    <option value="">{t("anyArea")}</option>
                    {areas.map((area) => (
                      <option key={area.slug} value={area.slug}>
                        {area.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <Button type="submit" variant="brand" className="mt-2 w-full sm:mt-0 sm:w-auto">
                {t("searchAction")}
              </Button>
            </div>
          </form>
        </div>
      </section>

      <section className="app-shell mt-8">
        {products === null ? (
          <Card className="p-8 text-center">
            <p className="text-sm text-[var(--color-muted-foreground)]">{t("unavailable")}</p>
          </Card>
        ) : results.length === 0 ? (
          <Card className="p-8 text-center sm:p-12">
            <span className="mx-auto grid size-12 place-items-center rounded-2xl bg-[var(--color-muted)] text-[var(--color-muted-foreground)]">
              <PackageSearch aria-hidden="true" className="size-6" />
            </span>
            <h2 className="mt-4 text-lg font-bold tracking-[-0.02em]">
              {filtered ? t("noneMatch") : t("noneYet")}
            </h2>
            <p className="mx-auto mt-2 max-w-[48ch] text-sm leading-relaxed text-[var(--color-muted-foreground)]">
              {filtered ? t("noneMatchBody") : t("noneYetBody")}
            </p>
            {filtered ? (
              <Button asChild variant="outline" className="mt-5">
                <Link href="/marketplace">{t("clearFilters")}</Link>
              </Button>
            ) : (
              <Button asChild variant="brand" className="mt-5">
                <Link href="/trainer/join">
                  <Store aria-hidden="true" />
                  {t("sellHere")}
                </Link>
              </Button>
            )}
          </Card>
        ) : (
          <>
            <p className="mb-4 text-sm text-[var(--color-muted-foreground)]">
              {t("count", { count: products.count })}
            </p>
            <div className="grid grid-cols-2 gap-3.5 sm:gap-4 lg:grid-cols-4">
              {results.map((product) => (
                <ProductTile key={product.id} product={product} />
              ))}
            </div>
          </>
        )}
      </section>
    </div>
  );
}
