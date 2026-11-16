"use client";

import { ChevronDown, Store } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";

import { AskSeller } from "@/components/marketplace/AskSeller";
import { BuyNow } from "@/components/marketplace/BuyNow";
import { OrderFromMaker } from "@/components/marketplace/OrderFromMaker";
import { getWhoami } from "@/lib/session-api";
import type { ProductDetail } from "@/lib/types";

/**
 * What a visitor can do with a product, in the order a first-time buyer
 * needs it:
 *
 * - a maker who takes payment on the site: Buy now, and Add to bag;
 * - one who does not yet: "Order from the maker", with a line saying why
 *   there is no Buy now and how paying works;
 * - either way, "Ask a question" as a smaller link underneath.
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
  const left = product.few_left ?? 20;
  const deposit =
    product.availability === "made_to_order" && product.seller.deposit_percent ? product.seller.deposit_percent : null;

  return (
    <div className="space-y-3">
      {soldOut ? null : product.buy_online && product.price ? (
        <BuyNow
          productId={product.id}
          productName={product.name}
          price={product.price}
          options={product.options}
          sellerId={product.seller.id}
          sellerName={product.seller.business_name}
          maxQuantity={left}
          deposit={deposit}
        />
      ) : (
        <OrderFromMaker
          productId={product.id}
          sellerName={product.seller.business_name}
          price={product.price}
          options={product.options}
          delivers={product.seller.delivery_fee !== null}
          maxQuantity={left}
        />
      )}
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
