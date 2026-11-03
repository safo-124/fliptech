"use client";

import { Printer } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";

import { BrandMark } from "@/components/BrandMark";
import { Button } from "@/components/ui/button";
import { BRAND } from "@/lib/brand";
import { formatCedis } from "@/lib/format";
import { getOrder } from "@/lib/marketplace-api";
import type { MarketplaceOrder } from "@/lib/types";

/**
 * A receipt for a paid order, laid out for paper: "Print or save as PDF"
 * uses the browser's own print, which every phone can save as a PDF.
 */
export function OrderReceipt({ reference }: { reference: string }) {
  const t = useTranslations("Marketplace");
  const [order, setOrder] = useState<MarketplaceOrder | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    getOrder(reference)
      .then(setOrder)
      .catch((error: Error) => setProblem(error.message));
  }, [reference]);

  if (problem) return <p role="alert" className="text-sm text-[var(--color-destructive)]">{problem}</p>;
  if (!order) return null;

  const paidAt = order.paid_at ? new Date(order.paid_at) : null;
  return (
    <div className="space-y-4">
      <div className="flex justify-end print:hidden">
        <Button type="button" variant="outline" onClick={() => window.print()}>
          <Printer aria-hidden="true" />
          {t("receiptPrint")}
        </Button>
      </div>
      <article className="rounded-2xl border border-[var(--color-border)] bg-white p-6 text-sm text-black print:border-0 print:p-0">
        <header className="flex items-start justify-between gap-4 border-b border-black/10 pb-4">
          <div className="flex items-center gap-2">
            <BrandMark className="size-8" />
            <span className="text-lg font-extrabold">{BRAND}</span>
          </div>
          <div className="text-right">
            <p className="text-base font-bold">{t("receiptTitle")}</p>
            <p className="font-mono text-xs">{order.reference}</p>
            {paidAt ? (
              <p className="text-xs">
                {t("receiptPaid", {
                  date: paidAt.toLocaleDateString("en-GH", { day: "numeric", month: "long", year: "numeric" }),
                })}
              </p>
            ) : null}
          </div>
        </header>
        <div className="grid gap-4 py-4 sm:grid-cols-2">
          <div>
            <p className="text-xs uppercase tracking-wide text-black/60">Seller</p>
            <p className="font-semibold">{order.seller_name}</p>
          </div>
          <div>
            <p className="text-xs uppercase tracking-wide text-black/60">Buyer</p>
            <p className="font-semibold">{order.buyer_name}</p>
            <p>{order.buyer_phone}</p>
          </div>
        </div>
        <table className="w-full border-collapse">
          <tbody>
            {order.items.map((item, index) => (
              <tr key={index} className="border-t border-black/10">
                <td className="py-2">
                  {item.quantity} × {item.product_name}
                  {item.option_label ? ` (${item.option_label})` : ""}
                </td>
                <td className="py-2 text-right tabular-nums">
                  {formatCedis(String(Number(item.unit_price) * item.quantity))}
                </td>
              </tr>
            ))}
            {Number(order.discount) > 0 ? (
              <tr className="border-t border-black/10">
                <td className="py-2">{order.discount_code}</td>
                <td className="py-2 text-right tabular-nums">−{formatCedis(order.discount)}</td>
              </tr>
            ) : null}
            {Number(order.delivery) > 0 ? (
              <tr className="border-t border-black/10">
                <td className="py-2">{t("deliveryLine")}</td>
                <td className="py-2 text-right tabular-nums">{formatCedis(order.delivery)}</td>
              </tr>
            ) : null}
            <tr className="border-t-2 border-black font-bold">
              <td className="py-2">{t("totalLine")}</td>
              <td className="py-2 text-right tabular-nums">{formatCedis(order.amount)}</td>
            </tr>
            {order.plan !== "full" ? (
              <tr>
                <td className="py-1 text-black/70">
                  {t("receiptPaidOnline")}
                </td>
                <td className="py-1 text-right tabular-nums text-black/70">{formatCedis(order.deposit)}</td>
              </tr>
            ) : null}
          </tbody>
        </table>
        <p className="mt-6 text-xs text-black/60">
          Paid through {BRAND} with Paystack. Keep this receipt; it is your proof of payment if anything goes wrong.
        </p>
      </article>
    </div>
  );
}
