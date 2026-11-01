"use client";

import { Minus, Plus, ShoppingBag, Trash2 } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";

import { Checkout } from "@/components/marketplace/Checkout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { bagFor, onBagChange, setBagLines, type StoredBag } from "@/lib/bag";

/** One maker's bag: change amounts, remove things, then pay once. */
export function BagView({ sellerId }: { sellerId: number }) {
  const t = useTranslations("Marketplace");
  const [bag, setBag] = useState<StoredBag | null | undefined>(undefined);

  useEffect(() => {
    const sync = () => setBag(bagFor(sellerId));
    sync();
    return onBagChange(sync);
  }, [sellerId]);

  if (bag === undefined) return null;
  if (!bag || !bag.items.length) {
    return (
      <Card className="p-8 text-center">
        <ShoppingBag aria-hidden="true" className="mx-auto size-6 text-[var(--color-muted-foreground)]" />
        <p className="mt-3 font-semibold">{t("bagEmpty")}</p>
        <Button asChild variant="outline" className="mt-4">
          <Link href="/marketplace">{t("backToMarketplace")}</Link>
        </Button>
      </Card>
    );
  }

  const lines = bag.items;
  function change(index: number, quantity: number) {
    const next = lines
      .map((line, position) => (position === index ? { ...line, quantity } : line))
      .filter((line) => line.quantity > 0);
    setBagLines(sellerId, next);
  }

  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-extrabold tracking-[-0.03em]">
        {t("bagHeading", { seller: bag.sellerName })}
      </h1>
      <Card>
        <CardContent className="divide-y divide-[var(--color-border)] pt-2">
          {lines.map((line, index) => (
            <div key={`${line.product}-${line.option}`} className="flex items-center justify-between gap-3 py-3">
              <div className="min-w-0">
                <Link href={`/marketplace/${line.product}`} className="text-sm font-semibold hover:underline">
                  {line.name}
                </Link>
                {line.optionLabel ? (
                  <p className="text-xs text-[var(--color-muted-foreground)]">{line.optionLabel}</p>
                ) : null}
              </div>
              <div className="flex items-center gap-1">
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  aria-label={t("less")}
                  onClick={() => change(index, line.quantity - 1)}
                >
                  {line.quantity === 1 ? <Trash2 aria-hidden="true" /> : <Minus aria-hidden="true" />}
                </Button>
                <span className="w-6 text-center text-sm tabular-nums">{line.quantity}</span>
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  aria-label={t("more")}
                  disabled={line.quantity >= 20}
                  onClick={() => change(index, line.quantity + 1)}
                >
                  <Plus aria-hidden="true" />
                </Button>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>{t("payForBag")}</CardTitle>
        </CardHeader>
        <CardContent>
          <Checkout
            sellerId={sellerId}
            sellerName={bag.sellerName}
            items={lines.map(({ product, option, quantity }) => ({ product, option, quantity }))}
            onPaying={() => setBagLines(sellerId, [])}
          />
        </CardContent>
      </Card>
    </div>
  );
}
