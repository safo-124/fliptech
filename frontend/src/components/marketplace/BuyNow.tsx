"use client";

import { Check, ShoppingBag, Zap } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { addToBag } from "@/lib/bag";
import { formatCedis } from "@/lib/format";
import type { ProductOption } from "@/lib/types";

/**
 * Paying for a product on its page, or putting it in the bag to pay for
 * several things from this maker at once.
 *
 * A product with sizes or colours asks which one first; the price follows
 * the choice. "Buy now" puts it in the bag and opens the one checkout page
 * (the bag page); "Add to bag" keeps shopping. Neither needs an account.
 */
export function BuyNow({
  productId,
  productName,
  price,
  options,
  sellerId,
  sellerName,
  maxQuantity = 20,
  deposit,
}: {
  productId: number;
  productName: string;
  price: string;
  options: ProductOption[];
  sellerId: number;
  sellerName: string;
  /** "Only N left": no more than that can be bought. */
  maxQuantity?: number;
  /** Made to order with a deposit: the share paid now, in percent. */
  deposit?: number | null;
}) {
  const t = useTranslations("Marketplace");
  const router = useRouter();
  const most = Math.max(1, Math.min(20, maxQuantity));
  const choosable = options.filter((option) => option.available);
  const [option, setOption] = useState<number | null>(choosable.length === 1 ? choosable[0].id : null);
  const [quantity, setQuantity] = useState(1);
  const [added, setAdded] = useState(false);

  const chosen = options.find((item) => item.id === option) ?? null;
  const needsChoice = choosable.length > 0 && chosen === null;
  const unit = chosen?.price ?? price;

  function add() {
    addToBag(sellerId, sellerName, {
      product: productId,
      option,
      quantity,
      name: productName,
      optionLabel: chosen?.label ?? "",
    });
    setAdded(true);
  }

  function buyNow() {
    add();
    router.push(`/marketplace/bag/${sellerId}`);
  }

  // Made to order with a deposit: what is paid now and when it is ready.
  const depositNow = deposit ? (Number(unit) * quantity * deposit) / 100 : null;

  return (
    <Card className="border-[var(--color-brand)]/30">
      <CardHeader>
        <div className="mb-2 grid size-11 place-items-center rounded-xl bg-[var(--color-brand)] text-white">
          <ShoppingBag aria-hidden="true" className="size-5" />
        </div>
        <CardTitle>{t("buyTitle")}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {options.length ? (
          <fieldset>
            <legend className="text-sm font-medium">{t("chooseOption")}</legend>
            <div className="mt-1.5 flex flex-wrap gap-2">
              {options.map((item) => (
                <label
                  key={item.id}
                  className={`flex min-h-11 cursor-pointer items-center gap-1.5 rounded-lg border px-3 text-sm has-[:checked]:border-[var(--color-brand)] has-[:checked]:bg-[var(--color-brand-soft)] ${
                    item.available ? "border-[var(--color-border)]" : "cursor-not-allowed border-dashed opacity-50"
                  }`}
                >
                  <input
                    type="radio"
                    className="sr-only"
                    disabled={!item.available}
                    checked={option === item.id}
                    onChange={() => {
                      setOption(item.id);
                      setAdded(false);
                    }}
                  />
                  {item.label}
                  {item.price && item.price !== price ? (
                    <span className="text-xs text-[var(--color-muted-foreground)]">
                      {formatCedis(item.price)}
                    </span>
                  ) : null}
                </label>
              ))}
            </div>
          </fieldset>
        ) : null}

        <div className="flex items-end gap-3">
          <div className="w-24">
            <Label htmlFor="buy-quantity">{t("quantityLabel")}</Label>
            <input
              id="buy-quantity"
              type="number"
              inputMode="numeric"
              min={1}
              max={most}
              value={quantity}
              onChange={(event) => {
                setQuantity(Math.min(most, Math.max(1, Number(event.target.value) || 1)));
                setAdded(false);
              }}
              aria-describedby={most < 20 ? "buy-quantity-left" : undefined}
              className="mt-1.5 h-12 w-full rounded-lg border border-[var(--color-input)] bg-[var(--color-card)] px-3 text-base"
            />
          </div>
          <p className="pb-3 text-sm text-[var(--color-muted-foreground)]">
            {t("each", { price: formatCedis(unit) })}
            {most < 20 ? (
              <span id="buy-quantity-left" className="block font-semibold text-[var(--color-warn)]">
                {t("onlyLeft", { count: most })}
              </span>
            ) : null}
          </p>
        </div>

        {depositNow !== null ? (
          <p className="rounded-xl bg-[var(--color-brand-soft)] px-3 py-2.5 text-sm font-semibold text-[var(--color-brand-strong)]">
            {t("depositPlain", {
              now: formatCedis(depositNow.toFixed(2)),
              later: formatCedis((Number(unit) * quantity - depositNow).toFixed(2)),
            })}
          </p>
        ) : null}

        {needsChoice ? (
          <p className="text-sm text-[var(--color-muted-foreground)]">{t("chooseOptionFirst")}</p>
        ) : null}
        <div className="grid gap-2">
          <Button type="button" variant="brand" className="min-h-12 w-full text-base" disabled={needsChoice} onClick={buyNow}>
            <Zap aria-hidden="true" />
            {t("buyTitle")}
          </Button>
          <Button type="button" variant="outline" className="min-h-12 w-full" disabled={needsChoice} onClick={add}>
            {added ? <Check aria-hidden="true" /> : <ShoppingBag aria-hidden="true" />}
            {added ? t("addedToBag") : t("addToBag")}
          </Button>
          {added ? (
            <Link
              href={`/marketplace/bag/${sellerId}`}
              className="inline-flex min-h-11 items-center justify-center text-sm font-semibold text-[var(--color-brand)] hover:underline"
            >
              {t("seeBag")}
            </Link>
          ) : null}
        </div>
        <p className="text-xs text-[var(--color-muted-foreground)]">{t("payMomoCard", { seller: sellerName })}</p>
      </CardContent>
    </Card>
  );
}
