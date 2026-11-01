import { BadgeCheck, Zap } from "lucide-react";
import { useTranslations } from "next-intl";

import type { SellerCard } from "@/lib/types";

/** "Verified maker" and "Usually replies within a day", where earned. */
export function SellerBadges({ seller, compact = false }: { seller: SellerCard; compact?: boolean }) {
  const t = useTranslations("Marketplace");
  if (!seller.verified && !seller.replies_fast) return null;
  const pill = compact
    ? "inline-flex items-center gap-1 text-[11px] font-semibold"
    : "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold";
  return (
    <span className="flex flex-wrap gap-1.5">
      {seller.verified ? (
        <span className={`${pill} ${compact ? "text-[var(--color-visit)]" : "bg-[var(--color-visit-bg)] text-[var(--color-visit)]"}`}>
          <BadgeCheck aria-hidden="true" className="size-3.5" />
          {t("verifiedMaker")}
        </span>
      ) : null}
      {seller.replies_fast ? (
        <span className={`${pill} ${compact ? "text-[var(--color-brand-strong)]" : "bg-[var(--color-brand-soft)] text-[var(--color-brand-strong)]"}`}>
          <Zap aria-hidden="true" className="size-3.5" />
          {compact ? t("repliesFastShort") : t("repliesFast")}
        </span>
      ) : null}
    </span>
  );
}

/** A price, with the pre-sale price crossed out beside it. */
export function SalePrice({ was }: { was: string | null }) {
  const t = useTranslations("Marketplace");
  if (!was) return null;
  return (
    <span className="ml-2 text-[0.7em] font-semibold text-[var(--color-muted-foreground)] line-through">
      <span className="sr-only">{t("wasPrice")} </span>
      GH₵{Number(was).toLocaleString("en-GH", { maximumFractionDigits: 2 })}
    </span>
  );
}
