import { MapPin, Star } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useTranslations } from "next-intl";

import { SaveButton } from "@/components/marketplace/SaveButton";
import { SalePrice, SellerBadges } from "@/components/marketplace/SellerBadges";
import { Card } from "@/components/ui/card";
import { formatFee } from "@/lib/format";
import { tradeClass } from "@/lib/trades";
import type { ProductCard } from "@/lib/types";

/**
 * One product in a list.
 *
 * Three things a buyer decides on, in the order they decide them: what it
 * looks like, what it costs, and where it is. Where matters more here than on
 * a training card — the seller arranges delivery themselves at this stage, so
 * distance is the whole cost of a purchase and burying it would waste
 * everybody's time.
 */
export function ProductTile({ product }: { product: ProductCard }) {
  const t = useTranslations("Marketplace");
  const tFormat = useTranslations("Format");
  const gone = product.availability === "sold_out";

  return (
    <article className="relative h-full">
      <Card
        className={`group h-full overflow-hidden transition-[border-color,box-shadow,transform] hover:-translate-y-0.5 hover:border-[var(--color-brand)]/30 hover:shadow-[var(--shadow-lg)] ${
          gone ? "opacity-70" : ""
        }`}
      >
        <Link href={`/marketplace/${product.id}`} className="block">
          <div
            className={`${tradeClass(product.trade?.colour ?? "violet")} relative aspect-[4/3] overflow-hidden bg-[var(--trade-bg)]`}
          >
            {product.photo ? (
              <Image
                src={product.photo}
                alt=""
                fill
                sizes="(min-width: 1024px) 25vw, (min-width: 640px) 50vw, 100vw"
                className="object-cover transition-transform duration-500 group-hover:scale-[1.03]"
              />
            ) : (
              <span className="absolute inset-0 grid place-items-center text-[11px] font-bold uppercase tracking-[0.1em] text-[var(--trade-fg)] opacity-70">
                {t("noPhoto")}
              </span>
            )}
            {gone ? (
              <span className="absolute left-2 top-2 rounded-full bg-[var(--color-card)] px-2.5 py-1 text-[10px] font-extrabold uppercase tracking-[0.06em] text-[var(--color-muted-foreground)]">
                {t("soldOut")}
              </span>
            ) : product.availability === "made_to_order" ? (
              <span className="absolute left-2 top-2 rounded-full bg-[var(--color-card)] px-2.5 py-1 text-[10px] font-extrabold uppercase tracking-[0.06em] text-[var(--trade-fg)]">
                {t("madeToOrder")}
              </span>
            ) : null}
            {/* Said plainly: a paid place at the top is not a judgement
                that this is the best one. */}
            {product.sponsored ? (
              <span className="absolute bottom-2 left-2 rounded-full bg-black/60 px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.06em] text-white">
                {t("sponsored")}
              </span>
            ) : null}
          </div>

          <div className="p-3.5">
            <h3 className="line-clamp-2 text-sm font-bold leading-snug tracking-[-0.015em]">
              {product.name}
            </h3>
            <p className="mt-1.5 text-base font-extrabold tracking-[-0.02em]">
              {product.price === null ? (
                <span className="text-sm font-semibold text-[var(--color-muted-foreground)]">
                  {t("onRequest")}
                </span>
              ) : (
                <>
                  {formatFee(product.price, tFormat)}
                  <SalePrice was={product.was_price} />
                </>
              )}
            </p>
            <p className="mt-2 truncate text-xs text-[var(--color-muted-foreground)]">
              {product.seller.business_name} &middot; {product.seller.area}
            </p>
            <div className="mt-1">
              <SellerBadges seller={product.seller} compact />
            </div>
            {product.seller.rating || product.distance_km !== null ? (
              <p className="mt-1 flex flex-wrap items-center gap-x-2.5 text-xs text-[var(--color-muted-foreground)]">
                {product.seller.rating ? (
                  <span className="inline-flex items-center gap-1 font-semibold text-[var(--color-foreground)]">
                    <Star aria-hidden="true" className="size-3 fill-amber-400 text-amber-400" />
                    {t("rating", product.seller.rating)}
                  </span>
                ) : null}
                {product.distance_km !== null ? (
                  <span className="inline-flex items-center gap-1">
                    <MapPin aria-hidden="true" className="size-3" />
                    {t("distance", { km: product.distance_km })}
                  </span>
                ) : null}
              </p>
            ) : null}
          </div>
        </Link>
      </Card>
      {/* Outside the link: a button inside an anchor is not allowed, and a
          tap on the heart must not open the product. */}
      <SaveButton
        productId={product.id}
        labels={{ save: t("saveForLater"), saved: t("savedForLater") }}
        className="absolute right-2 top-2"
      />
    </article>
  );
}
