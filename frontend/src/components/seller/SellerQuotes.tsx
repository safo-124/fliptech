"use client";

import { FileText, Loader2, Lock, Phone } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCedis } from "@/lib/format";
import { getSellerQuotes, unlockQuote, type SellerQuote } from "@/lib/seller-api";

/**
 * Bulk and custom jobs buyers asked for in this seller's trades.
 *
 * The job is shown in full; who asked is shown once the seller takes it up
 * (free on the Shop plan, otherwise the lead fee through Paystack). A few
 * makers at most can take each one, so the buyer is not called by twenty.
 */
export function SellerQuotesTab() {
  const t = useTranslations("SellerGrowth");
  const [data, setData] = useState<Awaited<ReturnType<typeof getSellerQuotes>> | null>(null);
  const [busy, setBusy] = useState<number | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  const load = useCallback(() => getSellerQuotes().then(setData), []);

  useEffect(() => {
    let active = true;
    getSellerQuotes()
      .then((found) => {
        if (active) setData(found);
      })
      .catch(() => {
        if (active) setProblem(t("loadFailed"));
      });
    return () => {
      active = false;
    };
  }, [t]);

  async function unlock(quote: SellerQuote) {
    setBusy(quote.id);
    setProblem(null);
    try {
      const result = await unlockQuote(quote.id);
      if (result.authorization_url) {
        window.location.assign(result.authorization_url);
        return;
      }
      await load();
    } catch (reason) {
      setProblem(reason instanceof Error ? reason.message : t("somethingWrong"));
    }
    setBusy(null);
  }

  if (!data) {
    return (
      <Card className="p-8 text-center">
        {problem ? (
          <p className="text-sm text-[var(--color-destructive)]">{problem}</p>
        ) : (
          <Loader2 aria-hidden="true" className="mx-auto size-5 animate-spin text-[var(--color-muted-foreground)]" />
        )}
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("quotesTitle")}</CardTitle>
        <CardDescription>
          {data.free_on_plan
            ? t("quotesLeadPlan")
            : t("quotesLead", { price: formatCedis(data.lead_price) })}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {problem ? (
          <p role="alert" className="text-sm text-[var(--color-destructive)]">
            {problem}
          </p>
        ) : null}
        {data.results.length ? (
          data.results.map((quote) => (
            <div key={quote.id} className="rounded-xl border border-[var(--color-border)] p-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-semibold">{quote.title}</p>
                  <p className="text-xs text-[var(--color-muted-foreground)]">
                    {[quote.trade, quote.area, quote.quantity && t("quoteQuantity", { quantity: quote.quantity }), quote.budget && t("quoteBudget", { budget: quote.budget }), quote.needed_by && t("quoteNeededBy", { date: new Date(quote.needed_by).toLocaleDateString(undefined, { day: "numeric", month: "short" }) })]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                </div>
                <span className="text-xs text-[var(--color-muted-foreground)]">
                  {t("spotsLeft", { count: quote.spots_left })}
                </span>
              </div>
              <p className="mt-2 whitespace-pre-line text-sm">{quote.details}</p>
              <div className="mt-3">
                {quote.unlocked ? (
                  <Button asChild size="sm" variant="brand">
                    <a href={`tel:${quote.buyer_phone}`}>
                      <Phone aria-hidden="true" />
                      {t("callBuyer", { name: quote.buyer_name ?? "", phone: quote.buyer_phone ?? "" })}
                    </a>
                  </Button>
                ) : quote.spots_left ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={busy !== null || (!data.free_on_plan && !data.payments_enabled)}
                    onClick={() => unlock(quote)}
                  >
                    {busy === quote.id ? <Loader2 aria-hidden="true" className="animate-spin" /> : <Lock aria-hidden="true" />}
                    {data.free_on_plan ? t("unlockFree") : t("unlockPaid", { price: formatCedis(data.lead_price) })}
                  </Button>
                ) : (
                  <p className="text-xs text-[var(--color-muted-foreground)]">{t("quoteFull")}</p>
                )}
              </div>
            </div>
          ))
        ) : (
          <div className="py-6 text-center">
            <FileText aria-hidden="true" className="mx-auto size-6 text-[var(--color-muted-foreground)]" />
            <p className="mt-2 text-sm text-[var(--color-muted-foreground)]">{t("noQuotes")}</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
