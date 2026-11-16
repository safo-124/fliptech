"use client";

import { Handshake, Loader2, ShoppingBasket, Store, Truck } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { useTranslations } from "next-intl";

import { BasketLineRow } from "@/components/basket/BasketLineRow";
import { useBasket } from "@/components/basket/useBasket";
import { SellerBadges } from "@/components/marketplace/SellerBadges";
import { Button } from "@/components/ui/button";
import type { BasketGroup } from "@/lib/basket";
import { formatCedis } from "@/lib/format";
import { cn } from "@/lib/utils";

/** /marketplace/basket: everything chosen, by seller, as the server groups
    it. Each seller is paid (or sent the order) on their own. */
export function BasketPage() {
  const t = useTranslations("Basket");
  const basket = useBasket();

  if (basket === null) {
    return (
      <p className="flex items-center gap-2 py-10 text-sm text-[var(--color-muted-foreground)]">
        <Loader2 aria-hidden="true" className="size-4 animate-spin" />
        {t("loading")}
      </p>
    );
  }
  if (!basket.groups.length) {
    return (
      <div className="mx-auto flex max-w-sm flex-col items-center gap-3 py-12 text-center">
        <span className="grid size-16 place-items-center rounded-full bg-[var(--color-brand-soft)]">
          <ShoppingBasket aria-hidden="true" className="size-8 text-[var(--color-brand)]" />
        </span>
        <h2 className="text-xl font-bold">{t("emptyTitle")}</h2>
        <p className="text-sm text-[var(--color-muted-foreground)]">{t("emptyBody")}</p>
        <Button asChild variant="brand" className="min-h-12 w-full">
          <Link href="/marketplace">{t("backToMarket")}</Link>
        </Button>
      </div>
    );
  }
  return (
    <div className="space-y-5">
      {basket.notice ? (
        <p role="status" className="rounded-xl bg-[var(--color-warn-bg)] px-3 py-2 text-sm font-semibold text-[var(--color-warn)]">
          {basket.notice}
        </p>
      ) : null}
      {basket.groups.map((group) => (
        <SellerGroup key={group.seller.id} group={group} />
      ))}
    </div>
  );
}

function SellerGroup({ group }: { group: BasketGroup }) {
  const t = useTranslations("Basket");
  const [way, setWay] = useState<"pickup" | "delivery">("pickup");
  const handover = group.delivery ? way : "pickup";
  const totals = group.totals[handover];
  const buyable = group.lines.some((line) => line.available);
  const seller = group.seller;
  const choice = (selected: boolean) =>
    cn(
      "flex min-h-12 cursor-pointer items-center gap-2 rounded-xl border-2 px-3 text-sm font-semibold",
      selected
        ? "border-[var(--color-brand)] bg-[var(--color-brand-soft)] text-[var(--color-brand-strong)]"
        : "border-[var(--color-border)]",
    );
  const amount = totals ? formatCedis(totals.plan === "full" ? totals.total : totals.pay_now) : "";

  return (
    <section className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-card)] p-4">
      <header className="flex items-start gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-[var(--color-brand-soft)]">
          <Store aria-hidden="true" className="size-5 text-[var(--color-brand)]" />
        </span>
        <div className="min-w-0">
          <h2 className="truncate text-base font-bold">
            <Link href={`/marketplace/seller/${seller.id}`} className="hover:underline">
              {seller.business_name}
            </Link>
          </h2>
          {seller.area ? <p className="text-xs text-[var(--color-muted-foreground)]">{seller.area}</p> : null}
          <div className="mt-1">
            <SellerBadges seller={seller} compact />
          </div>
        </div>
      </header>

      <ul className="mt-2 divide-y divide-[var(--color-border)]">
        {group.lines.map((line) => (
          <BasketLineRow key={line.id} line={line} />
        ))}
      </ul>

      {buyable ? (
        <div className="mt-3 space-y-3 border-t border-[var(--color-border)] pt-3">
          {group.delivery ? (
            <fieldset>
              <legend className="sr-only">{t("collect")} / {t("delivery")}</legend>
              <div className="grid grid-cols-2 gap-2">
                <label className={choice(handover === "pickup")}>
                  <input type="radio" className="sr-only" checked={handover === "pickup"} onChange={() => setWay("pickup")} />
                  <Store aria-hidden="true" className="size-4" />
                  {t("collect")}
                </label>
                <label className={choice(handover === "delivery")}>
                  <input type="radio" className="sr-only" checked={handover === "delivery"} onChange={() => setWay("delivery")} />
                  <Truck aria-hidden="true" className="size-4" />
                  <span>
                    {t("delivery")}
                    <span className="block text-xs font-normal">{t("deliveryFee", { fee: formatCedis(group.delivery.fee) })}</span>
                  </span>
                </label>
              </div>
            </fieldset>
          ) : null}

          {totals ? (
            <dl className="space-y-1 text-sm">
              <div className="flex justify-between gap-3">
                <dt>{t("subtotal")}</dt>
                <dd className="tabular-nums">{formatCedis(totals.subtotal)}</dd>
              </div>
              {handover === "delivery" ? (
                <div className="flex justify-between gap-3">
                  <dt>{t("delivery")}</dt>
                  <dd className="tabular-nums">{formatCedis(totals.delivery)}</dd>
                </div>
              ) : null}
              <div className="flex justify-between gap-3 text-base font-bold">
                <dt>{t("total")}</dt>
                <dd className="tabular-nums">{formatCedis(totals.total)}</dd>
              </div>
            </dl>
          ) : null}
          {group.problem ? (
            <p role="alert" className="text-sm text-[var(--color-destructive)]">
              {group.problem}
            </p>
          ) : null}

          {group.takes_payments ? null : (
            <p className="flex items-start gap-2 rounded-xl bg-[var(--color-warn-bg)] px-3 py-2.5 text-sm">
              <Handshake aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-[var(--color-warn)]" />
              {t("directNote")}
            </p>
          )}
          <Button
            asChild
            variant="brand"
            className={cn(
              "h-auto min-h-12 w-full whitespace-normal py-2.5 text-center text-base",
              !totals && "pointer-events-none opacity-50",
            )}
          >
            <Link href={`/marketplace/checkout/${seller.id}?way=${handover}`} aria-disabled={!totals}>
              {group.takes_payments
                ? totals?.plan === "deposit" || totals?.plan === "collect"
                  ? t("payDepositAction", { total: amount })
                  : t("payAction", { total: amount })
                : t("sendOrder", { seller: seller.business_name })}
            </Link>
          </Button>
        </div>
      ) : null}
    </section>
  );
}
