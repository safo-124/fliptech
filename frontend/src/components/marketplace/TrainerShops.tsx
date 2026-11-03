import { ArrowRight, GraduationCap } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useTranslations } from "next-intl";

import type { TrainerShop } from "@/lib/types";

/**
 * Training workshops that also sell. The marketplace's strongest promise is
 * "made by somebody who teaches it", so these get a row of their own: each
 * links to its shop, and the heading to every product they sell.
 */
export function TrainerShops({ shops }: { shops: TrainerShop[] }) {
  const t = useTranslations("Marketplace");
  if (!shops.length) return null;

  return (
    <section aria-labelledby="trainer-shops" className="mb-8">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 id="trainer-shops" className="flex items-center gap-2 text-xl font-extrabold tracking-[-0.025em]">
            <GraduationCap aria-hidden="true" className="size-5 text-[var(--color-brand)]" />
            {t("trainersTitle")}
          </h2>
          <p className="mt-1 max-w-[60ch] text-sm text-[var(--color-muted-foreground)]">{t("trainersBody")}</p>
        </div>
        <Link
          href="/marketplace?sold_by=trainers"
          className="inline-flex items-center gap-1 text-sm font-bold text-[var(--color-brand)]"
        >
          {t("trainersSeeAll")}
          <ArrowRight aria-hidden="true" className="size-4" />
        </Link>
      </div>
      <ul className="-mx-4 mt-4 flex snap-x gap-3 overflow-x-auto px-4 pb-2 sm:mx-0 sm:grid sm:grid-cols-3 sm:overflow-visible sm:px-0 lg:grid-cols-6">
        {shops.map((shop) => (
          <li key={shop.id} className="w-40 shrink-0 snap-start sm:w-auto">
            <Link
              href={`/marketplace/seller/${shop.id}`}
              className="group block h-full overflow-hidden rounded-2xl border border-[var(--color-border)] bg-[var(--color-card)] transition hover:-translate-y-0.5 hover:border-[var(--color-brand)]/30"
            >
              <div className="relative aspect-square bg-[var(--color-muted)]">
                {shop.photo ? (
                  <Image src={shop.photo} alt="" fill sizes="(min-width: 1024px) 16vw, (min-width: 640px) 33vw, 160px" className="object-cover" />
                ) : null}
                <span className="absolute left-2 top-2 inline-flex items-center gap-1 rounded-full bg-[var(--color-brand)] px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-[0.06em] text-white">
                  <GraduationCap aria-hidden="true" className="size-3" />
                  {t("trainerBadge")}
                </span>
              </div>
              <p className="truncate px-3 pt-2.5 text-sm font-bold">{shop.business_name}</p>
              <p className="truncate px-3 pb-3 text-xs text-[var(--color-muted-foreground)]">
                {shop.area} · {t("trainersProducts", { count: shop.product_count })}
              </p>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
