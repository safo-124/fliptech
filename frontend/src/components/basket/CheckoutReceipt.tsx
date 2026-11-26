"use client";

import { CheckCircle2, Clock, Loader2, Package, XCircle } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import { checkoutReceipt, loadBasket, type CheckoutReceipt as Receipt } from "@/lib/basket";
import { formatCedis } from "@/lib/format";

/**
 * Where Paystack sends a buyer back after paying several sellers at once:
 * the one payment, and each seller's order under it with a link to its own
 * page (handover, problems and refunds are per seller).
 */
export function CheckoutReceipt({ reference }: { reference: string }) {
  const t = useTranslations("Basket");
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(true);

  // Only the answer sets state, so the effect never sets it synchronously.
  const ask = useCallback(
    () =>
      checkoutReceipt(reference, true)
        .then((found) => {
          setReceipt(found);
          setError(null);
          if (found.status === "paid") void loadBasket().catch(() => null);
        })
        .catch((reason) => setError(reason instanceof Error ? reason.message : t("loadFailed")))
        .finally(() => setBusy(false)),
    [reference, t],
  );

  useEffect(() => {
    void ask();
  }, [ask]);

  function check() {
    setBusy(true);
    setError(null);
    void ask();
  }

  if (busy && !receipt) {
    return (
      <p className="flex items-center gap-2 py-10 text-sm text-[var(--color-muted-foreground)]">
        <Loader2 aria-hidden="true" className="size-4 animate-spin" />
        {t("receiptChecking")}
      </p>
    );
  }
  if (!receipt) {
    return (
      <div className="space-y-3 py-8">
        <p role="alert">{error ?? t("loadFailed")}</p>
        <Button variant="outline" className="min-h-11" onClick={check}>
          {t("tryAgain")}
        </Button>
      </div>
    );
  }

  const paid = receipt.status === "paid";
  const failed = receipt.status === "failed";
  const Icon = paid ? CheckCircle2 : failed ? XCircle : Clock;
  return (
    <div className="space-y-5">
      <div className="flex flex-col items-center gap-2 text-center">
        <Icon
          aria-hidden="true"
          className={
            paid
              ? "size-14 text-[var(--color-visit)]"
              : failed
                ? "size-14 text-[var(--color-destructive)]"
                : "size-14 text-[var(--color-warn)]"
          }
        />
        <h1 className="text-2xl font-extrabold tracking-[-0.02em]">
          {paid ? t("receiptPaid") : failed ? t("receiptFailed") : t("receiptWaiting")}
        </h1>
        <p className="text-sm text-[var(--color-muted-foreground)]">
          {paid
            ? t("receiptPaidBody", { total: formatCedis(receipt.amount), count: receipt.orders.length })
            : failed
              ? t("receiptFailedBody")
              : t("receiptWaitingBody")}
        </p>
        <p className="text-xs text-[var(--color-muted-foreground)]">
          {t("receiptReference", { reference: receipt.reference })}
        </p>
      </div>

      {!paid ? (
        <div className="flex flex-col gap-2 sm:flex-row">
          {failed ? (
            <Button asChild variant="brand" className="min-h-12 flex-1">
              <Link href="/marketplace/checkout">{t("tryAgain")}</Link>
            </Button>
          ) : (
            <Button variant="brand" className="min-h-12 flex-1" onClick={check} disabled={busy}>
              {busy ? <Loader2 aria-hidden="true" className="animate-spin" /> : null}
              {t("receiptCheckAgain")}
            </Button>
          )}
          <Button asChild variant="outline" className="min-h-12 flex-1">
            <Link href="/marketplace/basket">{t("viewBasket")}</Link>
          </Button>
        </div>
      ) : null}

      <ul className="space-y-3">
        {receipt.orders.map((order) => (
          <li key={order.reference} className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-card)] p-4">
            <div className="flex items-start justify-between gap-3">
              <h2 className="flex min-w-0 items-center gap-2 text-base font-bold">
                <Package aria-hidden="true" className="size-4 shrink-0 text-[var(--color-brand)]" />
                <span className="truncate">{order.seller_name}</span>
              </h2>
              <p className="shrink-0 font-bold tabular-nums">{formatCedis(order.amount)}</p>
            </div>
            <ul className="mt-2 space-y-0.5 text-sm text-[var(--color-muted-foreground)]">
              {order.items.map((item, index) => (
                <li key={`${item.product}-${index}`}>
                  {item.quantity} × {item.product_name}
                  {item.option_label ? ` (${item.option_label})` : ""}
                </li>
              ))}
            </ul>
            <p className="mt-2 text-xs text-[var(--color-muted-foreground)]">
              {order.fulfilment === "delivery" ? t("delivery") : t("collect")} · {order.reference}
            </p>
            {paid ? (
              <Button asChild variant="outline" className="mt-3 min-h-11 w-full">
                <Link href={`/marketplace/order/${order.reference}`}>{t("seeOrder")}</Link>
              </Button>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
