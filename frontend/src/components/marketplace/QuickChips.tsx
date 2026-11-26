import { LocateFixed, X } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";

import { marketHref } from "@/components/marketplace/MarketFilters";
import { NearMeButton } from "@/components/marketplace/NearMeButton";
import type { MarketplaceParams } from "@/lib/api";

const CHIP =
  "inline-flex min-h-11 shrink-0 items-center gap-2 whitespace-nowrap rounded-full border px-4 text-[0.9375rem] font-medium transition-colors";
const OFF = `${CHIP} border-[var(--color-border)] bg-[var(--color-card)] hover:border-[var(--color-border-strong)]`;
const ON = `${CHIP} border-[var(--color-brand)] bg-[var(--color-brand)] text-white`;

/**
 * The few things most people want, one tap each: near me, cheapest first,
 * new, used, and delivers. Each is a link that turns it on, or off again when
 * it is purple. Everything else is in the More sheet (`more`).
 */
export function QuickChips({ params, more }: { params: MarketplaceParams; more: React.ReactNode }) {
  const t = useTranslations("Marketplace");
  const toggle = (
    on: boolean,
    change: Partial<Record<keyof MarketplaceParams, string | undefined>>,
    off: Partial<Record<keyof MarketplaceParams, undefined>>,
  ) => marketHref(params, { ...(on ? off : change), page: undefined });

  const cheapest = params.sort === "price";
  const used = params.condition === "used";
  const brandNew = params.condition === "new";
  const delivers = Boolean(params.delivers);

  return (
    <div className="relative mt-6 flex flex-wrap items-center gap-2">
      {params.near ? (
        <Link href={marketHref(params, { near: undefined, sort: params.sort === "nearest" ? undefined : params.sort, page: undefined })} className={ON}>
          <LocateFixed aria-hidden="true" className="size-4" />
          {t("nearMe")}
          <X aria-hidden="true" className="size-4" />
        </Link>
      ) : (
        <NearMeButton
          labels={{ action: t("nearMe"), finding: t("findingYou"), refused: t("nearMeRefused") }}
          className={`${OFF} text-[var(--color-foreground)] disabled:opacity-70`}
          refusedClassName="text-sm text-[var(--color-muted-foreground)]"
        />
      )}
      <Link href={toggle(cheapest, { sort: "price" }, { sort: undefined })} className={cheapest ? ON : OFF} aria-current={cheapest ? "true" : undefined}>
        {t("chipCheapest")}
      </Link>
      <Link href={toggle(brandNew, { condition: "new" }, { condition: undefined })} className={brandNew ? ON : OFF} aria-current={brandNew ? "true" : undefined}>
        {t("chipNew")}
      </Link>
      <Link href={toggle(used, { condition: "used" }, { condition: undefined })} className={used ? ON : OFF} aria-current={used ? "true" : undefined}>
        {t("chipUsed")}
      </Link>
      <Link href={toggle(delivers, { delivers: "1" }, { delivers: undefined })} className={delivers ? ON : OFF} aria-current={delivers ? "true" : undefined}>
        {t("filterDelivers")}
      </Link>
      {more}
    </div>
  );
}
