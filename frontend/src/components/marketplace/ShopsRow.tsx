import { ArrowRight, Store } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";

import { ShopCard } from "@/components/marketplace/ShopCard";
import type { ShopCard as Shop } from "@/lib/types";

/**
 * The shops on Fliiptech, a row above the marketplace's items: trainers'
 * shops first (the marketplace's strongest promise is "made by somebody who
 * teaches it"), then the rest. Each opens its shop; the heading's link opens
 * every shop (/marketplace/shops).
 */
export function ShopsRow({ shops }: { shops: Shop[] }) {
  const t = useTranslations("Marketplace");
  if (!shops.length) return null;

  return (
    <section aria-labelledby="shops-row" className="mb-8">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 id="shops-row" className="flex items-center gap-2 text-xl font-extrabold tracking-[-0.025em]">
            <Store aria-hidden="true" className="size-5 text-[var(--color-brand)]" />
            {t("shopsTitle")}
          </h2>
          <p className="mt-1 max-w-[60ch] text-sm text-[var(--color-muted-foreground)]">{t("shopsBody")}</p>
        </div>
        <Link href="/marketplace/shops" className="inline-flex items-center gap-1 text-sm font-bold text-[var(--color-brand)]">
          {t("shopsSeeAll")}
          <ArrowRight aria-hidden="true" className="size-4" />
        </Link>
      </div>
      <ul className="-mx-3 mt-4 flex snap-x gap-3 overflow-x-auto px-3 pb-2 sm:mx-0 sm:grid sm:grid-cols-3 sm:overflow-visible sm:px-0 lg:grid-cols-4 xl:grid-cols-6">
        {shops.map((shop) => (
          <li key={shop.id} className="w-44 shrink-0 snap-start sm:w-auto">
            <ShopCard shop={shop} compact />
          </li>
        ))}
      </ul>
    </section>
  );
}
