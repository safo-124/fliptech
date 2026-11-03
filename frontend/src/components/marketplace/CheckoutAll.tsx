"use client";

import { ShoppingBag } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";

import { Checkout } from "@/components/marketplace/Checkout";
import { Button } from "@/components/ui/button";
import { allBags, onBagChange, setBagLines, syncBagWithAccount, type StoredBag } from "@/lib/bag";

/**
 * One checkout for the whole bag. Each seller is still paid separately (the
 * money goes straight to them), but the buyer fills in their details once:
 * the first seller's checkout carries the rest as a queue, and each order
 * page offers the next payment.
 */
export function CheckoutAll() {
  const t = useTranslations("Marketplace");
  const [bags, setBags] = useState<[string, StoredBag][] | null>(null);

  useEffect(() => {
    const load = () => setBags(Object.entries(allBags()));
    load();
    void syncBagWithAccount();
    return onBagChange(load);
  }, []);

  if (bags === null) return null;
  if (!bags.length) {
    return (
      <div className="rounded-2xl border border-dashed border-[var(--color-border-strong)] p-8 text-center">
        <ShoppingBag aria-hidden="true" className="mx-auto size-6 text-[var(--color-muted-foreground)]" />
        <p className="mt-3 text-sm text-[var(--color-muted-foreground)]">{t("savedEmpty")}</p>
        <Button asChild variant="outline" className="mt-4">
          <Link href="/marketplace">{t("backToMarketplace")}</Link>
        </Button>
      </div>
    );
  }

  const [[firstId, first], ...rest] = bags;
  const queue = rest.map(([sellerId, bag]) => ({
    sellerId: Number(sellerId),
    sellerName: bag.sellerName,
    items: bag.items.map(({ product, option, quantity }) => ({ product, option, quantity })),
  }));

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-extrabold tracking-[-0.03em]">{t("checkoutAllTitle")}</h1>
        <p className="mt-1 text-sm text-[var(--color-muted-foreground)]">{t("checkoutAllBody")}</p>
      </div>
      <ol className="space-y-2">
        {bags.map(([sellerId, bag], index) => (
          <li
            key={sellerId}
            className={`flex items-center gap-3 rounded-xl border px-4 py-3 text-sm ${
              index === 0 ? "border-[var(--color-brand)] bg-[var(--color-brand-soft)]" : "border-[var(--color-border)]"
            }`}
          >
            <span className="grid size-7 shrink-0 place-items-center rounded-full bg-[var(--color-card)] text-xs font-bold">
              {index + 1}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block font-semibold">{bag.sellerName}</span>
              <span className="block truncate text-xs text-[var(--color-muted-foreground)]">
                {bag.items.map((item) => `${item.quantity} × ${item.name}`).join(", ")}
              </span>
            </span>
          </li>
        ))}
      </ol>
      <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-card)] p-5">
        <h2 className="mb-3 text-base font-bold">
          {t("checkoutStep", { seller: first.sellerName, step: 1, total: bags.length })}
        </h2>
        {rest.length ? (
          <p className="mb-3 text-sm text-[var(--color-muted-foreground)]">
            {t("checkoutThen", { sellers: rest.map(([, bag]) => bag.sellerName).join(", ") })}
          </p>
        ) : null}
        <Checkout
          sellerId={Number(firstId)}
          sellerName={first.sellerName}
          items={first.items.map(({ product, option, quantity }) => ({ product, option, quantity }))}
          queue={queue}
          onPaying={() => setBagLines(Number(firstId), [])}
        />
      </div>
    </div>
  );
}
