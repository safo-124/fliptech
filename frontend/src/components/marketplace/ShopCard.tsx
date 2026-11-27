import { GraduationCap, Star } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useTranslations } from "next-intl";

import type { ShopCard as Shop } from "@/lib/types";

/**
 * One shop in the marketplace's Shops view and its Shops row: a strip of its
 * product photos, its name, town, rating and how many things it sells. The
 * whole card opens the shop, where everything it sells is listed. Trainers'
 * shops carry the badge: "made by somebody who teaches it".
 */
export function ShopCard({ shop, compact = false }: { shop: Shop; compact?: boolean }) {
  const t = useTranslations("Marketplace");
  const photos = shop.photos?.length ? shop.photos : shop.photo ? [shop.photo] : [];
  return (
    <Link
      href={`/marketplace/seller/${shop.id}`}
      className="group block h-full overflow-hidden rounded-2xl border border-[var(--color-border)] bg-[var(--color-card)] transition hover:-translate-y-0.5 hover:border-[var(--color-brand)]/30"
    >
      <div className="relative grid aspect-[4/3] grid-cols-2 grid-rows-2 gap-0.5 bg-[var(--color-muted)]">
        {photos.length === 0 ? null : photos.length < 4 ? (
          <div className="relative col-span-2 row-span-2">
            <Image src={photos[0]} alt="" fill sizes="(min-width: 1024px) 25vw, 50vw" className="object-cover" />
          </div>
        ) : (
          photos.slice(0, 4).map((photo) => (
            <div key={photo} className="relative">
              <Image src={photo} alt="" fill sizes="(min-width: 1024px) 12vw, 25vw" className="object-cover" />
            </div>
          ))
        )}
        {shop.is_trainer ? (
          <span className="absolute left-2 top-2 inline-flex items-center gap-1 rounded-full bg-[var(--color-brand)] px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-[0.06em] text-white">
            <GraduationCap aria-hidden="true" className="size-3" />
            {t("trainerBadge")}
          </span>
        ) : null}
      </div>
      <div className={compact ? "px-3 py-2.5" : "px-3.5 py-3"}>
        <p className="truncate text-sm font-bold">{shop.business_name}</p>
        <p className="mt-0.5 flex items-center gap-1.5 truncate text-xs text-[var(--color-muted-foreground)]">
          <span className="truncate">
            {shop.area} · {t("trainersProducts", { count: shop.product_count })}
          </span>
          {shop.rating ? (
            <span className="inline-flex shrink-0 items-center gap-0.5 font-semibold text-[var(--color-foreground)]">
              <Star aria-hidden="true" className="size-3 fill-amber-400 text-amber-400" />
              {shop.rating.average.toFixed(1)}
            </span>
          ) : null}
        </p>
      </div>
    </Link>
  );
}
