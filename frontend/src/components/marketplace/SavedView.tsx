"use client";

import { Heart, ShoppingBag } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";

import { ProductTile } from "@/components/marketplace/ProductTile";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { searchProducts } from "@/lib/api";
import { allBags, onBagChange, savedIds, type StoredBag } from "@/lib/bag";
import type { ProductCard } from "@/lib/types";

/** What this browser saved, and any bags waiting to be paid for. */
export function SavedView() {
  const t = useTranslations("Marketplace");
  const [products, setProducts] = useState<ProductCard[] | null>(null);
  const [bags, setBags] = useState<Record<string, StoredBag>>({});

  useEffect(() => {
    let active = true;
    async function load() {
      setBags(allBags());
      const ids = savedIds();
      if (!ids.length) {
        if (active) setProducts([]);
        return;
      }
      try {
        const found = await searchProducts({ ids: ids.join(",") });
        // In the order they were saved, newest first.
        const byId = new Map(found.results.map((product) => [product.id, product]));
        if (active) setProducts(ids.flatMap((id) => byId.get(id) ?? []));
      } catch {
        if (active) setProducts([]);
      }
    }
    void load();
    const stop = onBagChange(() => void load());
    return () => {
      active = false;
      stop();
    };
  }, []);

  const bagList = Object.entries(bags);
  return (
    <div className="space-y-8">
      {bagList.length ? (
        <section>
          <h2 className="text-lg font-extrabold tracking-[-0.025em]">{t("yourBags")}</h2>
          <ul className="mt-3 space-y-2">
            {bagList.map(([sellerId, bag]) => (
              <li key={sellerId}>
                <Link
                  href={`/marketplace/bag/${sellerId}`}
                  className="flex min-h-11 items-center justify-between gap-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-card)] px-4 py-3 text-sm hover:border-[var(--color-brand)]"
                >
                  <span className="inline-flex items-center gap-2 font-semibold">
                    <ShoppingBag aria-hidden="true" className="size-4 text-[var(--color-brand)]" />
                    {bag.sellerName}
                  </span>
                  <span className="text-[var(--color-muted-foreground)]">
                    {t("bagItems", { count: bag.items.reduce((n, item) => n + item.quantity, 0) })}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section>
        <h1 className="text-2xl font-extrabold tracking-[-0.03em]">{t("savedTitle")}</h1>
        {products === null ? null : products.length ? (
          <div className="mt-4 grid grid-cols-2 gap-3.5 sm:gap-4 lg:grid-cols-4">
            {products.map((product) => (
              <ProductTile key={product.id} product={product} />
            ))}
          </div>
        ) : (
          <Card className="mt-4 p-8 text-center">
            <Heart aria-hidden="true" className="mx-auto size-6 text-[var(--color-muted-foreground)]" />
            <p className="mt-3 text-sm text-[var(--color-muted-foreground)]">{t("savedEmpty")}</p>
            <Button asChild variant="outline" className="mt-4">
              <Link href="/marketplace">{t("backToMarketplace")}</Link>
            </Button>
          </Card>
        )}
      </section>
    </div>
  );
}
