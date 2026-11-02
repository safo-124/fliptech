"use client";

import { useEffect, useState } from "react";

import { ProductTile } from "@/components/marketplace/ProductTile";
import { searchProducts } from "@/lib/api";
import { recentIds } from "@/lib/bag";
import type { ProductCard } from "@/lib/types";

/**
 * What this browser looked at lately, newest first. Kept on the phone only
 * (lib/bag.ts), and shown only when there is something to show.
 */
export function RecentlyViewed({ title, exclude }: { title: string; exclude?: number }) {
  const [products, setProducts] = useState<ProductCard[]>([]);

  useEffect(() => {
    let active = true;
    const ids = recentIds().filter((id) => id !== exclude).slice(0, 8);
    if (!ids.length) return;
    searchProducts({ ids: ids.join(",") })
      .then((found) => {
        if (!active) return;
        const byId = new Map(found.results.map((product) => [product.id, product]));
        setProducts(ids.flatMap((id) => byId.get(id) ?? []).slice(0, 4));
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [exclude]);

  if (!products.length) return null;
  return (
    <section className="mt-10">
      <h2 className="text-lg font-extrabold tracking-[-0.025em]">{title}</h2>
      <div className="mt-4 grid grid-cols-2 gap-3.5 sm:gap-4 lg:grid-cols-4">
        {products.map((product) => (
          <ProductTile key={product.id} product={product} />
        ))}
      </div>
    </section>
  );
}
