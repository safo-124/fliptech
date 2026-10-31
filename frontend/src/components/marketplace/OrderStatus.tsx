"use client";

import { CheckCircle2, Loader2, Phone, XCircle } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCedis } from "@/lib/format";
import { confirmOrder } from "@/lib/marketplace-api";
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
        <p>
          {t("orderLine", {
            quantity: order.quantity,
            product: order.product_name,
            total: formatCedis(order.amount),
          })}
        </p>
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
