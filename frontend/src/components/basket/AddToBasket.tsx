"use client";

import { Handshake, Loader2, ShoppingBasket, Zap } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useTranslations } from "next-intl";

import { showBasketToast } from "@/components/basket/BasketToast";
import { Stepper } from "@/components/basket/Stepper";
import { Button } from "@/components/ui/button";
import { addToBasket } from "@/lib/basket";
import { formatCedis } from "@/lib/format";
import type { ProductDetail } from "@/lib/types";

/**
 * A product page's buying panel: choose a size or colour if there are any,
 * how many (up to what is left), then "Add to basket" (a toast, no page
 * change) or "Order now" (into the basket and straight to checkout with
 * this maker). Every rule is the server's: the stepper only stops at the
 * stock it was told about.
 */
export function AddToBasket({ product }: { product: ProductDetail }) {
  const t = useTranslations("Basket");
  const tMarket = useTranslations("Marketplace");
  const router = useRouter();
  const options = product.options;
  const choosable = options.filter((option) => option.available);
  const [option, setOption] = useState<number | null>(choosable.length === 1 ? choosable[0].id : null);
  const [quantity, setQuantity] = useState(1);
  const [busy, setBusy] = useState<"add" | "order" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const chosen = options.find((row) => row.id === option) ?? null;
  const needsChoice = choosable.length > 0 && chosen === null;
  const unit = chosen?.price ?? product.price;
  const most = Math.max(1, Math.min(20, product.few_left ?? 20));
  const direct = !product.buy_online;
  const deposit =
    product.availability === "made_to_order" && product.seller.deposit_percent && !direct
      ? product.seller.deposit_percent
      : null;

  async function put(then: "add" | "order") {
    setBusy(then);
    setError(null);
    try {
      const basket = await addToBasket(product.id, option, quantity);
      if (then === "order") {
        router.push("/marketplace/checkout");
        return;
      }
      showBasketToast(basket.notice || undefined, basket.added !== 0);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : tMarket("buyFailed"));
    }
    setBusy(null);
  }

  return (
    <section className="space-y-4 rounded-2xl border border-[var(--color-brand)]/30 bg-[var(--color-card)] p-4">
      {options.length ? (
        <fieldset>
          <legend className="text-sm font-medium">{tMarket("chooseOption")}</legend>
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
                  onChange={() => setOption(item.id)}
                />
                {item.label}
                {item.price && item.price !== product.price ? (
                  <span className="text-xs text-[var(--color-muted-foreground)]">{formatCedis(item.price)}</span>
                ) : null}
              </label>
            ))}
          </div>
        </fieldset>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="text-sm">
          <p className="font-medium">{t("quantity")}</p>
          {unit ? <p className="text-[var(--color-muted-foreground)]">{t("eachPrice", { price: formatCedis(unit) })}</p> : null}
          {product.few_left ? (
            <p className="font-semibold text-[var(--color-warn)]">{t("onlyLeft", { count: product.few_left })}</p>
          ) : null}
        </div>
        <Stepper value={quantity} max={most} onChange={setQuantity} label={t("quantity")} />
      </div>

      {deposit && unit ? (
        <p className="rounded-xl bg-[var(--color-brand-soft)] px-3 py-2.5 text-sm font-semibold text-[var(--color-brand-strong)]">
          {tMarket("depositPlain", {
            now: formatCedis(((Number(unit) * quantity * deposit) / 100).toFixed(2)),
            later: formatCedis((Number(unit) * quantity * (1 - deposit / 100)).toFixed(2)),
          })}
        </p>
      ) : null}
      {product.availability === "made_to_order" && product.make_days ? (
        <p className="text-sm text-[var(--color-muted-foreground)]">{t("aboutDays", { days: product.make_days })}</p>
      ) : null}

      {direct ? (
        <p className="flex items-start gap-2 rounded-xl bg-[var(--color-warn-bg)] px-3 py-2.5 text-sm">
          <Handshake aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-[var(--color-warn)]" />
          {t("notBuyableNow")}
        </p>
      ) : null}

      {error ? (
        <p role="alert" className="text-sm text-[var(--color-destructive)]">
          {error}
        </p>
      ) : null}
      {needsChoice ? <p className="text-sm text-[var(--color-muted-foreground)]">{tMarket("chooseOptionFirst")}</p> : null}

      {direct ? null : (
        <div className="grid gap-2 sm:grid-cols-2">
          <Button
          type="button"
          variant="brand"
          className="min-h-12 w-full text-base"
          disabled={needsChoice || busy !== null}
          onClick={() => void put("add")}
        >
          {busy === "add" ? <Loader2 aria-hidden="true" className="animate-spin" /> : <ShoppingBasket aria-hidden="true" />}
          {t("addToBasket")}
        </Button>
        <Button
          type="button"
          variant="outline"
          className="min-h-12 w-full text-base"
          disabled={needsChoice || busy !== null}
          onClick={() => void put("order")}
        >
          {busy === "order" ? <Loader2 aria-hidden="true" className="animate-spin" /> : <Zap aria-hidden="true" />}
          {t("orderNow")}
          </Button>
        </div>
      )}
      {direct ? null : (
        <p className="text-xs text-[var(--color-muted-foreground)]">
          {tMarket("payMomoCard", { seller: product.seller.business_name })}
        </p>
      )}
    </section>
  );
}
