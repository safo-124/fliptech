"use client";

import { Heart } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";

import { ProductTile } from "@/components/marketplace/ProductTile";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { searchProducts } from "@/lib/api";
import { StockAlert } from "@/components/marketplace/StockAlert";
import { onBagChange, savedIds, syncSavedWithAccount } from "@/lib/bag";
import type { ProductCard } from "@/lib/types";

/** What this browser (or the account) saved for later. The basket has its
    own page, /marketplace/basket. */
export function SavedView() {
  const t = useTranslations("Marketplace");
  const [products, setProducts] = useState<ProductCard[] | null>(null);
  // Signed in: the list is the account's, on every phone they sign in on.
  const [onAccount, setOnAccount] = useState(false);

  useEffect(() => {
    let active = true;
    async function load() {
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
    // What another phone saved, here too (the change event reloads the list).
    void syncSavedWithAccount().then((synced) => {
      if (active) setOnAccount(synced);
    });
    const stop = onBagChange(() => void load());
    return () => {
      active = false;
      stop();
    };
  }, []);

  return (
    <div className="space-y-8">
      <section>
        <h1 className="text-2xl font-extrabold tracking-[-0.03em]">{t("savedTitle")}</h1>
        {products === null ? null : products.length ? (
          <div className="mt-4 grid grid-cols-2 gap-3.5 sm:gap-4 lg:grid-cols-4">
            {products.map((product) => (
              <div key={product.id} className="space-y-2">
                <ProductTile product={product} />
                {product.availability === "sold_out" ? <StockAlert productId={product.id} /> : null}
              </div>
            ))}
          </div>
        ) : (
          <Card className="mt-4 p-8 text-center">
            <Heart aria-hidden="true" className="mx-auto size-6 text-[var(--color-muted-foreground)]" />
            <p className="mt-3 text-sm text-[var(--color-muted-foreground)]">{t(onAccount ? "savedEmptyAccount" : "savedEmpty")}</p>
            <Button asChild variant="outline" className="mt-4">
              <Link href="/marketplace">{t("backToMarketplace")}</Link>
            </Button>
          </Card>
        )}
      </section>
    </div>
  );
}
