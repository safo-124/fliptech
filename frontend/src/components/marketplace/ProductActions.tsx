"use client";

import { ChevronDown, Store } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";

import { AddToBasket } from "@/components/basket/AddToBasket";
import { AskSeller } from "@/components/marketplace/AskSeller";
import { getWhoami } from "@/lib/session-api";
import type { ProductDetail } from "@/lib/types";

/**
 * What a visitor can do with a product: "Add to basket" and "Order now"
 * (into the basket and straight to checkout with this maker), with a line
 * saying how paying works for a maker who takes payment directly; then
 * "Ask a question" as a smaller link underneath.
 *
 * The maker looking at their own item sees none of it (the server refuses
 * an order on your own shop too), just a link to their shop.
 */
export function ProductActions({ product }: { product: ProductDetail }) {
  const t = useTranslations("Marketplace");
  const [own, setOwn] = useState(false);

  useEffect(() => {
    let active = true;
    getWhoami()
      .then((who) => active && setOwn(who.seller?.id === product.seller.id))
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [product.seller.id]);

  if (own) {
    return (
      <p className="flex items-start gap-2 rounded-2xl bg-[var(--color-muted)] px-4 py-3 text-sm">
        <Store aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-[var(--color-brand)]" />
        <span>
          {t("yourOwnItem")}{" "}
          <Link href="/sell/shop" className="font-semibold text-[var(--color-brand)] hover:underline">
            {t("openYourShop")}
          </Link>
        </span>
      </p>
    );
  }

  const soldOut = product.availability === "sold_out";

  return (
    <div className="space-y-3">
      {soldOut || product.price === null ? null : <AddToBasket product={product} />}
      <details className="group">
        <summary className="inline-flex min-h-11 cursor-pointer list-none items-center gap-1.5 text-sm font-semibold text-[var(--color-brand)] hover:underline">
          {t("askAQuestion")}
          <ChevronDown aria-hidden="true" className="size-4 transition-transform group-open:rotate-180" />
        </summary>
        <div className="mt-2">
          <AskSeller productId={product.id} sellerName={product.seller.business_name} />
        </div>
      </details>
    </div>
  );
}
