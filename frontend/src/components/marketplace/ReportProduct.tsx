"use client";

import { Flag, Loader2 } from "lucide-react";
import { useState } from "react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import { reportProduct, type ReportReason } from "@/lib/marketplace-api";

const REASONS: ReportReason[] = ["scam", "not_as_described", "not_delivered", "prohibited", "other"];

/** "Report this product": a reason and a few words to staff. No account. */
export function ReportProduct({ productId }: { productId: number }) {
  const t = useTranslations("Marketplace");
  const [reason, setReason] = useState<ReportReason>("scam");
  const [details, setDetails] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function send(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await reportProduct(productId, { reason, details: details.trim() || undefined });
      setDone(t("reportThanks"));
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : t("reportFailed"));
    }
    setBusy(false);
  }

  return (
    <details className="px-1 text-sm">
      <summary className="inline-flex min-h-11 cursor-pointer list-none items-center gap-1.5 text-xs font-semibold text-[var(--color-muted-foreground)] hover:text-[var(--color-destructive)] [&::-webkit-details-marker]:hidden">
        <Flag aria-hidden="true" className="size-3.5" />
        {t("reportLink")}
      </summary>
      {done ? (
        <p role="status" className="mt-2 text-sm text-[var(--color-visit)]">
          {done}
        </p>
      ) : (
        <form onSubmit={send} className="mt-2 space-y-2.5 rounded-xl border border-[var(--color-border)] p-3">
          <label htmlFor="report-reason" className="text-sm font-medium">
            {t("reportReasonLabel")}
          </label>
          <select
            id="report-reason"
            value={reason}
            onChange={(event) => setReason(event.target.value as ReportReason)}
            className="h-11 w-full rounded-lg border border-[var(--color-input)] bg-[var(--color-card)] px-3 text-sm"
          >
            {REASONS.map((value) => (
              <option key={value} value={value}>
                {t(`reportReason.${value}`)}
              </option>
            ))}
          </select>
          <textarea
            aria-label={t("reportDetailsLabel")}
            rows={3}
            value={details}
            onChange={(event) => setDetails(event.target.value)}
            placeholder={t("reportDetailsLabel")}
            className="w-full rounded-lg border border-[var(--color-input)] bg-[var(--color-card)] px-3 py-2 text-sm"
          />
          {error ? <p className="text-sm text-[var(--color-destructive)]">{error}</p> : null}
          <Button type="submit" size="sm" variant="outline" disabled={busy}>
            {busy ? <Loader2 aria-hidden="true" className="animate-spin" /> : null}
            {t("reportSend")}
          </Button>
        </form>
      )}
    </details>
  );
}
