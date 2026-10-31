/**
 * A seller's shop front: who they are, and everything of theirs on sale.
 *
 * A seller nobody may see is a 404 from the API rather than an empty shop,
 * because an empty shop confirms the account exists. This page simply
 * follows that.
 */

import { ArrowLeft, BadgeCheck, MapPin, Star } from "lucide-react";
import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { ProductTile } from "@/components/marketplace/ProductTile";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ApiError, getSellerShop } from "@/lib/api";

export const revalidate = 300;

async function load(id: string) {
  try {
    return await getSellerShop(id);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return null;
    throw error;
  }
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const shop = await load((await params).id);
  if (!shop) return { title: "Not found" };
  return {
    title: shop.seller.business_name,
    description: shop.seller.about.slice(0, 200) || undefined,
  };
}

export default async function SellerShopPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [shop, t] = await Promise.all([load(id), getTranslations("Marketplace")]);
  if (!shop) notFound();

  const { seller, products, banner, reviews } = shop;

  return (
    <div className="app-shell py-6 pb-14">
      <Button asChild variant="ghost" size="sm" className="-ml-2 mb-4">
        <Link href="/marketplace">
          <ArrowLeft aria-hidden="true" />
          {t("backToMarketplace")}
        </Link>
      </Button>

      {/* A Shop plan benefit, sent only while the plan runs. */}
      {banner ? (
        <div className="relative mb-6 aspect-[3/1] overflow-hidden rounded-2xl bg-[var(--color-muted)] sm:aspect-[4/1]">
          <Image src={banner} alt="" fill priority sizes="100vw" className="object-cover" />
        </div>
      ) : null}

      <header className="mb-7">
        <h1 className="text-2xl font-extrabold tracking-[-0.03em] sm:text-3xl">
          {seller.business_name}
        </h1>
        <p className="mt-2 flex items-center gap-1.5 text-sm text-[var(--color-muted-foreground)]">
          <MapPin aria-hidden="true" className="size-4 shrink-0" />
          {seller.area}, {seller.region}
        </p>
        {seller.rating ? (
          <p className="mt-1.5 flex items-center gap-1.5 text-sm">
            <Star aria-hidden="true" className="size-4 fill-amber-400 text-amber-400" />
            <span className="font-semibold">{t("rating", seller.rating)}</span>
            <span className="text-[var(--color-muted-foreground)]">
              {t("reviewCount", { count: seller.rating.count })}
            </span>
          </p>
        ) : null}
        {seller.about ? (
          <p className="mt-3 max-w-[70ch] whitespace-pre-line text-sm leading-relaxed">
            {seller.about}
          </p>
        ) : null}
        {seller.workshop ? (
          <Link
            href={`/${seller.workshop.area_slug}/${seller.workshop.slug}`}
            className="mt-4 inline-flex items-start gap-2 rounded-xl bg-[var(--color-visit-bg)] px-3 py-2.5 text-sm text-[var(--color-visit)] hover:underline"
          >
            <BadgeCheck aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
            {t("alsoATrainingWorkshop", { name: seller.workshop.name })}
          </Link>
        ) : null}
      </header>

      {products.length ? (
        <div className="grid grid-cols-2 gap-3.5 sm:gap-4 lg:grid-cols-4">
          {products.map((product) => (
            <ProductTile key={product.id} product={product} />
          ))}
        </div>
      ) : (
        <Card className="p-8 text-center">
          <p className="text-sm text-[var(--color-muted-foreground)]">{t("shopEmpty")}</p>
        </Card>
      )}

      {/* Only buyers who asked or paid through the site could write these,
          from a link texted to them. */}
      {reviews.length ? (
        <section className="mt-12 max-w-3xl">
          <h2 className="text-lg font-extrabold tracking-[-0.025em]">{t("reviewsTitle")}</h2>
          <p className="mt-1 text-xs text-[var(--color-muted-foreground)]">{t("reviewsHow")}</p>
          <ul className="mt-4 space-y-3">
            {reviews.map((review) => (
              <li key={review.id}>
                <Card className="p-4">
                  <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
                    <span aria-label={t("stars", { count: review.rating })} className="flex">
                      {[1, 2, 3, 4, 5].map((n) => (
                        <Star
                          key={n}
                          aria-hidden="true"
                          className={`size-4 ${n <= review.rating ? "fill-amber-400 text-amber-400" : "text-[var(--color-border-strong)]"}`}
                        />
                      ))}
                    </span>
                    <span className="font-semibold">{review.buyer_name || t("aBuyer")}</span>
                    <span className="text-[var(--color-muted-foreground)]">
                      {review.bought ? t("boughtIt", { product: review.product_name }) : t("askedAbout", { product: review.product_name })}
                    </span>
                  </p>
                  {review.comment ? (
                    <p className="mt-2 whitespace-pre-line text-sm leading-relaxed">{review.comment}</p>
                  ) : null}
                </Card>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
