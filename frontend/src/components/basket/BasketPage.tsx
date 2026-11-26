"use client";

import { Loader2, LockKeyhole, ShoppingBasket, Store } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";

import { BasketLineRow } from "@/components/basket/BasketLineRow";
import { payableGroups } from "@/components/basket/CheckoutAll";
import { useBasket } from "@/components/basket/useBasket";
import { SellerBadges } from "@/components/marketplace/SellerBadges";
import { Button } from "@/components/ui/button";
import type { BasketGroup } from "@/lib/basket";
import { formatCedis } from "@/lib/format";

/** /marketplace/basket: everything chosen, by seller, and one button that
    pays for all of it (/marketplace/checkout). Fliiptech holds the money
    until the buyer has each seller's part. */
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
  const payable = payableGroups(basket.groups);
  const ready = payable.length > 0 && payable.every((group) => group.totals.pickup);
  const sum = payable.reduce((total, group) => total + Number(group.totals.pickup?.pay_now ?? 0), 0);
  const amount = formatCedis(sum.toFixed(2));
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
      {payable.length ? (
        <section className="rounded-2xl border-2 border-[var(--color-brand)]/40 bg-[var(--color-brand-soft)]/60 p-4">
          <div className="flex items-baseline justify-between gap-3 text-lg font-bold">
            <span>{t("total")}</span>
            <span className="tabular-nums">{amount}</span>
          </div>
          <p className="mt-1 text-sm text-[var(--color-muted-foreground)]">{t("heldNote")}</p>
          <Button
            asChild
            variant="brand"
            className={`mt-3 h-auto min-h-12 w-full whitespace-normal py-2.5 text-base ${ready ? "" : "pointer-events-none opacity-50"}`}
          >
            <Link href="/marketplace/checkout" aria-disabled={!ready}>
              <LockKeyhole aria-hidden="true" />
              {t("payAction", { total: amount })}
            </Link>
          </Button>
        </section>
      ) : null}
    </div>
  );
}

function SellerGroup({ group }: { group: BasketGroup }) {
  const t = useTranslations("Basket");
  const totals = group.totals.pickup;
  const buyable = group.lines.some((line) => line.available);
  const seller = group.seller;

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
        <div className="mt-3 space-y-2 border-t border-[var(--color-border)] pt-3">
          {group.takes_payments && totals ? (
            <div className="flex justify-between gap-3 text-sm font-semibold">
              <span>{t("subtotal")}</span>
              <span className="tabular-nums">{formatCedis(totals.pay_now)}</span>
            </div>
          ) : null}
          {group.problem ? (
            <p role="alert" className="text-sm text-[var(--color-destructive)]">
              {group.problem}
            </p>
          ) : null}
          {group.takes_payments ? null : (
            <p className="rounded-xl bg-[var(--color-warn-bg)] px-3 py-2.5 text-sm">{t("notPayableYet")}</p>
          )}
        </div>
      ) : null}
    </section>
  );
}
