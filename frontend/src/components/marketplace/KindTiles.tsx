import {
  Armchair,
  CookingPot,
  Droplets,
  Footprints,
  Palette,
  Scissors,
  Shirt,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";

import { marketHref } from "@/components/marketplace/MarketFilters";
import type { MarketplaceParams } from "@/lib/api";
import { MARKET_KINDS, type MarketKind } from "@/lib/market-kinds";

const ICONS: Record<MarketKind, LucideIcon> = {
  "hair-beauty": Scissors,
  clothes: Shirt,
  "bags-shoes": Footprints,
  furniture: Armchair,
  food: CookingPot,
  "soap-oils": Droplets,
  tools: Wrench,
  crafts: Palette,
};

/**
 * "Pick a kind of thing": eight big pictures with a word or two each, so a
 * shopper who does not read much can still find what they came for. Plain
 * links: tapping one again takes it off.
 */
export function KindTiles({ params }: { params: MarketplaceParams }) {
  const t = useTranslations("Marketplace");
  return (
    <nav aria-label={t("kindsTitle")} className="mt-7">
      <h2 className="text-lg font-semibold tracking-[-0.01em] text-[var(--color-brand-deep)]">{t("kindsTitle")}</h2>
      <ul className="mt-3 grid grid-cols-4 gap-2 sm:gap-2.5 lg:grid-cols-8">
        {MARKET_KINDS.map((kind) => {
          const Icon = ICONS[kind];
          const on = params.kind === kind;
          return (
            <li key={kind}>
              <Link
                href={marketHref(params, { kind: on ? undefined : kind, page: undefined })}
                aria-current={on ? "true" : undefined}
                className={`flex h-full flex-col items-center gap-2 rounded-2xl border px-1.5 py-3 text-center text-[0.8125rem] font-semibold leading-tight transition-colors sm:text-sm ${
                  on
                    ? "border-[var(--color-brand)] bg-[var(--color-brand-soft)] text-[var(--color-brand)]"
                    : "border-[var(--color-border)] bg-[var(--color-card)] hover:border-[var(--color-border-strong)]"
                }`}
              >
                <span
                  className={`grid size-11 place-items-center rounded-full sm:size-12 ${
                    on ? "bg-[var(--color-card)]" : "bg-[var(--color-brand-soft)]"
                  } text-[var(--color-brand)]`}
                >
                  <Icon aria-hidden="true" className="size-5 sm:size-6" />
                </span>
                {t(`kind.${kind}`)}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
