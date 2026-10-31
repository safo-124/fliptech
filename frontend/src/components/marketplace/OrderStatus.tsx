"use client";

import { CheckCircle2, Loader2, Phone, ShieldCheck, XCircle } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCedis } from "@/lib/format";
import { confirmOrder, confirmReceived, reportOrderProblem } from "@/lib/marketplace-api";
import type { MarketplaceOrder } from "@/lib/types";

/**
 * A buyer back from Paystack. Asks the server to confirm the payment (it
 * asks Paystack; nothing is taken on the browser's word) and says what
 * happens next: who will call, and how it is handed over.
 */
export function OrderStatus({ reference }: { reference: string }) {
  const t = useTranslations("Marketplace");
  const [order, setOrder] = useState<MarketplaceOrder | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [reporting, setReporting] = useState(false);
  const [complaint, setComplaint] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);

  async function act(action: () => Promise<MarketplaceOrder>) {
    setBusy(true);
    setActionError(null);
    try {
      setOrder(await action());
      setReporting(false);
    } catch (reason) {
      setActionError(reason instanceof Error ? reason.message : t("buyFailed"));
    }
    setBusy(false);
  }

  useEffect(() => {
    let active = true;
    // Paystack adds its own copies of the reference to the address.
    const url = new URL(window.location.href);
    if (url.search) window.history.replaceState(null, "", url.pathname);
    confirmOrder(reference)
      .then((found) => {
        if (active) setOrder(found);
      })
      .catch((reason) => {
        if (active) setProblem(reason instanceof Error ? reason.message : t("orderNotFound"));
      });
    return () => {
      active = false;
    };
  }, [reference, t]);

  if (problem) {
    return (
      <Card className="p-8 text-center">
        <p className="text-sm text-[var(--color-muted-foreground)]">{problem}</p>
        <p className="mt-2 text-xs text-[var(--color-muted-foreground)]">{t("orderTextHelp")}</p>
        <Button asChild variant="outline" className="mt-5">
          <Link href="/marketplace">{t("backToMarketplace")}</Link>
        </Button>
      </Card>
    );
  }

  if (order === null) {
    return (
      <Card className="p-8 text-center">
        <p className="inline-flex items-center gap-2 text-sm text-[var(--color-muted-foreground)]">
          <Loader2 aria-hidden="true" className="size-4 animate-spin" />
          {t("checkingPayment")}
        </p>
      </Card>
    );
  }

  const paid = order.status === "paid";
  return (
    <Card>
      <CardHeader>
        <div
          className={`mb-2 grid size-11 place-items-center rounded-xl ${
            paid
              ? "bg-[var(--color-visit-bg)] text-[var(--color-visit)]"
              : "bg-[var(--color-destructive)]/10 text-[var(--color-destructive)]"
          }`}
        >
          {paid ? <CheckCircle2 aria-hidden="true" className="size-5" /> : <XCircle aria-hidden="true" className="size-5" />}
        </div>
        <CardTitle>
          {paid ? t("orderPaidTitle") : order.status === "pending" ? t("orderPendingTitle") : t("orderFailedTitle")}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <ul className="space-y-1">
          {order.items.map((item, index) => (
            <li key={index} className="flex justify-between gap-3">
              <span className="min-w-0">
                {item.quantity} × {item.product_name}
                {item.option_label ? ` (${item.option_label})` : ""}
              </span>
              <span className="tabular-nums">
                {formatCedis((Number(item.unit_price) * item.quantity).toFixed(2))}
              </span>
            </li>
          ))}
          {Number(order.discount) > 0 ? (
            <li className="flex justify-between gap-3 text-[var(--color-visit)]">
              <span>{t("discountLine", { code: order.discount_code })}</span>
              <span className="tabular-nums">−{formatCedis(order.discount)}</span>
            </li>
          ) : null}
          {Number(order.delivery) > 0 ? (
            <li className="flex justify-between gap-3">
              <span>{t("deliveryLine")}</span>
              <span className="tabular-nums">{formatCedis(order.delivery)}</span>
            </li>
          ) : null}
          <li className="flex justify-between gap-3 border-t border-[var(--color-border)] pt-1 font-bold">
            <span>{t("totalLine")}</span>
            <span className="tabular-nums">{formatCedis(order.amount)}</span>
          </li>
        </ul>
        <p className="text-[var(--color-muted-foreground)]">
          {t("yourReference")} <strong className="font-mono">{order.reference}</strong>
        </p>
        {paid ? (
          <>
            <p className="leading-relaxed">
              {order.fulfilment === "delivery"
                ? t("orderDeliveryNext", { seller: order.seller_name })
                : t("orderPickupNext", { seller: order.seller_name })}
            </p>
            {order.seller_phone ? (
              <Button asChild variant="brand" className="w-full">
                <a href={`tel:${order.seller_phone}`}>
                  <Phone aria-hidden="true" />
                  {t("callSeller", { seller: order.seller_name })}
                </a>
              </Button>
            ) : null}
            {order.protected ? (
              <p className="flex items-start gap-1.5 rounded-lg bg-[var(--color-visit-bg)] p-3 text-xs text-[var(--color-visit)]">
                <ShieldCheck aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
                {t("protectedOrder", { seller: order.seller_name })}
              </p>
            ) : null}

            {order.stage === "problem" ? (
              <p role="status" className="rounded-lg bg-[var(--color-warn-bg)] p-3 text-sm text-[var(--color-warn)]">
                {t("problemReported")}
              </p>
            ) : order.stage === "received" ? (
              <p role="status" className="text-sm text-[var(--color-visit)]">
                {t("receivedThanks")}
              </p>
            ) : order.stage !== "refunded" ? (
              <div className="space-y-2">
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    disabled={busy}
                    onClick={() => act(() => confirmReceived(order.reference))}
                  >
                    {busy ? <Loader2 aria-hidden="true" className="animate-spin" /> : <CheckCircle2 aria-hidden="true" />}
                    {t("gotIt")}
                  </Button>
                  <Button type="button" variant="ghost" onClick={() => setReporting(!reporting)}>
                    {t("somethingWrong")}
                  </Button>
                </div>
                {reporting ? (
                  <form
                    onSubmit={(event) => {
                      event.preventDefault();
                      void act(() => reportOrderProblem(order.reference, complaint.trim()));
                    }}
                    className="space-y-2"
                  >
                    <textarea
                      aria-label={t("problemLabel")}
                      required
                      rows={3}
                      value={complaint}
                      onChange={(event) => setComplaint(event.target.value)}
                      placeholder={t("problemLabel")}
                      className="w-full rounded-lg border border-[var(--color-input)] bg-[var(--color-card)] px-3 py-2 text-sm"
                    />
                    <Button type="submit" size="sm" variant="brand" disabled={busy || !complaint.trim()}>
                      {t("problemSend")}
                    </Button>
                  </form>
                ) : null}
                {actionError ? <p className="text-sm text-[var(--color-destructive)]">{actionError}</p> : null}
              </div>
            ) : null}
            <p className="text-xs text-[var(--color-muted-foreground)]">{t("orderProblem")}</p>
          </>
        ) : order.status === "pending" ? (
          <p className="text-[var(--color-muted-foreground)]">{t("orderPendingBody")}</p>
        ) : (
          <p className="text-[var(--color-muted-foreground)]">{t("orderFailedBody")}</p>
        )}
        <Button asChild variant="outline" className="w-full">
          <Link href={order.product ? `/marketplace/${order.product}` : "/marketplace"}>
            {t("backToMarketplace")}
          </Link>
        </Button>
      </CardContent>
    </Card>
  );
}
