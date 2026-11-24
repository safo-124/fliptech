import { ReceiptText } from "lucide-react";
import { useTranslations } from "next-intl";

import { formatFee } from "@/lib/format";
import type { Programme } from "@/lib/types";

/**
 * What a course really costs, laid out like a receipt. The one receipt every
 * listing shows (components/ProviderProfile.tsx), so the wording cannot drift
 * between workshops.
 *
 * Hidden costs are the commonest complaint about apprenticeships: a fee that
 * looks cheaper until the trainee is told to buy their own tools and
 * materials. So each thing the fee might cover is a line marked included or
 * extra, the workshop's estimate for the extras is a line of its own, and the
 * bottom line is a total to plan for, or, without an estimate, says plainly
 * that the extras still have to be asked about.
 *
 * An estimate of nothing is no estimate: a workshop that marks the tools
 * "extra" and puts 0 against them has not said what they cost. It never reads
 * "Other costs about GH₵0" or "Plan for about" the fee alone.
 */

const RECEIPT_TONE = {
  plain: "text-[var(--color-foreground)]",
  included: "text-[var(--color-visit)]",
  extra: "text-[var(--color-warn)]",
} as const;

/** The extra cost the workshop gave, when it is more than nothing; null otherwise. */
export function knownExtraCosts(value: string | number | null | undefined): number | null {
  const amount = Number(value);
  return value !== null && value !== undefined && value !== "" && Number.isFinite(amount) && amount > 0
    ? amount
    : null;
}

/** One line of the receipt. Green only for what the fee covers; amber for what it does not. */
function ReceiptRow({
  label,
  value,
  tone = "plain",
}: {
  label: string;
  value: string;
  tone?: keyof typeof RECEIPT_TONE;
}) {
  return (
    <div className="flex items-baseline gap-2 py-1.5">
      <dt className="min-w-0">{label}</dt>
      {/* Dotted leader, as on a printed receipt. */}
      <span aria-hidden="true" className="min-w-4 flex-1 translate-y-[-3px] border-b border-dotted border-[var(--color-border-strong)]" />
      <dd className={`shrink-0 font-semibold tabular-nums ${RECEIPT_TONE[tone]}`}>
        {value}
      </dd>
    </div>
  );
}

export function FeeReceipt({ programme }: { programme: Programme }) {
  const t = useTranslations("ProviderProfile");
  const tFormat = useTranslations("Format");
  const covered = [
    ["tools", programme.fee_includes_tools],
    ["materials", programme.fee_includes_materials],
    ["ppe", programme.fee_includes_ppe],
  ] as const;
  const certificateExtra = Boolean(programme.certificate_awarded) && !programme.fee_includes_certificate;
  const anythingExtra = covered.some(([, included]) => !included) || certificateExtra;
  const extraCosts = knownExtraCosts(programme.extra_costs);
  const total = extraCosts !== null ? (Number(programme.fee) + extraCosts).toFixed(2) : null;

  return (
    <div className="mt-4 rounded-xl border border-[var(--color-border)] bg-[var(--color-card)] px-4 pb-3 pt-3.5">
      <p className="flex items-center gap-2 text-sm font-bold">
        <ReceiptText className="size-4 text-[var(--color-brand)]" aria-hidden="true" />
        {t("receiptTitle")}
      </p>
      <dl className="mt-1.5 text-sm">
        <ReceiptRow label={t("receiptFee")} value={formatFee(programme.fee, tFormat)} />
        {covered.map(([key, included]) => (
          <ReceiptRow
            key={key}
            label={t(`receiptItems.${key}`)}
            value={included ? t("included") : t("extra")}
            tone={included ? "included" : "extra"}
          />
        ))}
        <ReceiptRow
          label={programme.certificate_awarded || t("receiptItems.certificate")}
          value={
            !programme.certificate_awarded
              ? t("noneAwarded")
              : programme.fee_includes_certificate
                ? t("included")
                : t("extra")
          }
          tone={
            !programme.certificate_awarded
              ? "plain"
              : programme.fee_includes_certificate
                ? "included"
                : "extra"
          }
        />
        {extraCosts !== null ? (
          <ReceiptRow
            label={programme.extra_costs_note || t("receiptItems.otherCosts")}
            value={t("about", { amount: formatFee(String(extraCosts), tFormat) })}
            tone="extra"
          />
        ) : null}
      </dl>
      {/* The tear line. */}
      <div className="mt-2 flex items-baseline justify-between gap-3 border-t-2 border-dashed border-[var(--color-border-strong)] pt-2.5 text-base font-bold">
        <span>
          {total !== null ? t("planFor") : anythingExtra ? t("feePlusExtras") : t("allIncluded")}
        </span>
        <span className="tabular-nums">{formatFee(total ?? programme.fee, tFormat)}</span>
      </div>
      {total === null && anythingExtra ? (
        <p className="mt-1.5 text-xs leading-5 text-[var(--color-muted-foreground)]">
          {t("askAboutExtras")}
        </p>
      ) : null}
    </div>
  );
}
