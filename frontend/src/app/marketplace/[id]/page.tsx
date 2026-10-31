/**
 * One product, and the way to ask about it.
 *
 * The page is server-rendered; only the Ask panel is client code, and it is
 * below the fold on a phone. Everything a buyer needs to decide — the
 * pictures, the price, who made it and where they are — is in the HTML.
 */

import { ArrowLeft, BadgeCheck, MapPin, Share2, Star, Store } from "lucide-react";
import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { AskSeller } from "@/components/marketplace/AskSeller";
import { BuyNow } from "@/components/marketplace/BuyNow";
import { ProductViewBeacon } from "@/components/marketplace/ProductViewBeacon";
import { ProductTile } from "@/components/marketplace/ProductTile";
import { ClientMessages } from "@/i18n/ClientMessages";
import { MARKETPLACE_CLIENT_NAMESPACES } from "@/i18n/namespaces";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ApiError, getProduct, getSellerShop } from "@/lib/api";
import { BRAND } from "@/lib/brand";
import { formatFee } from "@/lib/format";
import { tradeClass } from "@/lib/trades";

export const revalidate = 300;

const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? "http://127.0.0.1:3000").replace(/\/$/, "");

async function load(id: string) {
  try {
    return await getProduct(id);
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
  const product = await load((await params).id);
  if (!product) return { title: "Not found" };
  const image = product.photos[0]?.image ?? product.photo;
  return {
    title: `${product.name} — ${product.seller.business_name}`,
    description: product.description.slice(0, 200) || undefined,
    // The picture WhatsApp and Facebook show when the link is shared.
    openGraph: image ? { images: [{ url: image, alt: product.name }] } : undefined,
  };
}

export default async function ProductPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [product, t, tFormat] = await Promise.all([
    load(id),
    getTranslations("Marketplace"),
    getTranslations("Format"),
  ]);
  if (!product) notFound();

  // The rest of this seller's shelf. Failing quietly: one product that
  // renders is better than a page that does not because a second call fell
  // over.
  const shop = await getSellerShop(product.seller.id).catch(() => null);
  const alsoFromSeller = (shop?.products ?? []).filter((item) => item.id !== product.id).slice(0, 4);

  // A message with the link, ready to send in WhatsApp. A plain link, so it
  // works before the page's JavaScript has loaded and costs nothing to ship.
  const price = product.price === null ? t("onRequest") : formatFee(product.price, tFormat);
  const shareHref = `https://wa.me/?text=${encodeURIComponent(
    t("shareText", {
      name: product.name,
      price,
      seller: product.seller.business_name,
      url: `${SITE_URL}/marketplace/${product.id}`,
    }),
  )}`;

  const photos = product.photos.length
    ? product.photos
    : product.photo
      ? [{ id: 0, image: product.photo, caption: "", display_order: 0 }]
      : [];

  return (
    <div className="app-shell py-6 pb-14">
      <Button asChild variant="ghost" size="sm" className="-ml-2 mb-4">
        <Link href="/marketplace">
          <ArrowLeft aria-hidden="true" />
          {t("backToMarketplace")}
        </Link>
      </Button>

      <div className="grid gap-7 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <div className="min-w-0">
          {photos.length ? (
            <div className="grid gap-3">
              <div
                className={`${tradeClass(product.trade?.colour ?? "violet")} relative aspect-[4/3] overflow-hidden rounded-2xl bg-[var(--trade-bg)]`}
              >
                {photos[0].image ? (
                  <Image
                    src={photos[0].image}
                    alt={photos[0].caption || product.name}
                    fill
                    sizes="(min-width: 1024px) 60vw, 100vw"
                    className="object-cover"
                    priority
                  />
                ) : null}
              </div>
              {photos.length > 1 ? (
                <div className="grid grid-cols-4 gap-3">
                  {photos.slice(1, 5).map((photo) => (
                    <div
                      key={photo.id}
                      className="relative aspect-square overflow-hidden rounded-xl bg-[var(--color-muted)]"
                    >
                      {photo.image ? (
                        <Image
                          src={photo.image}
                          alt={photo.caption || ""}
                          fill
                          sizes="25vw"
                          className="object-cover"
                        />
                      ) : null}
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          ) : (
            <div className="grid aspect-[4/3] place-items-center rounded-2xl bg-[var(--color-muted)] text-sm text-[var(--color-muted-foreground)]">
              {t("noPhoto")}
            </div>
          )}

          <div className="mt-6">
            {product.trade ? (
              <span
                className={`${tradeClass(product.trade.colour)} inline-block rounded-full bg-[var(--trade-bg)] px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.06em] text-[var(--trade-fg)]`}
              >
                {product.trade.name}
              </span>
            ) : null}
            <h1 className="mt-2.5 text-2xl font-extrabold tracking-[-0.03em] sm:text-3xl">
              {product.name}
            </h1>
            <p className="mt-2 text-2xl font-extrabold tracking-[-0.02em]">
              {product.price === null ? (
                <span className="text-lg font-semibold text-[var(--color-muted-foreground)]">
                  {t("onRequest")}
                </span>
              ) : (
                formatFee(product.price, tFormat)
              )}
            </p>
            <p className="mt-1.5 text-sm text-[var(--color-muted-foreground)]">
              {t(`availability.${product.availability}`)}
            </p>
            <a
              href={shareHref}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-4 inline-flex min-h-11 items-center gap-2 rounded-full border border-[var(--color-border-strong)] px-4 text-sm font-semibold hover:bg-[var(--color-muted)]"
            >
              <Share2 aria-hidden="true" className="size-4" />
              {t("shareOnWhatsApp")}
            </a>

            {product.description ? (
              <p className="mt-5 whitespace-pre-line text-sm leading-relaxed">
                {product.description}
              </p>
            ) : null}
          </div>
        </div>

        <aside className="min-w-0 space-y-4">
          <Card>
            <CardContent className="pt-5">
              <p className="text-xs font-semibold uppercase tracking-[0.1em] text-[var(--color-muted-foreground)]">
                {t("madeBy")}
              </p>
              <p className="mt-1.5 text-lg font-bold tracking-[-0.02em]">
                {product.seller.business_name}
              </p>
              {product.seller.rating ? (
                <p className="mt-1 flex items-center gap-1.5 text-sm">
                  <Star aria-hidden="true" className="size-4 fill-amber-400 text-amber-400" />
                  <span className="font-semibold">{t("rating", product.seller.rating)}</span>
                  <span className="text-[var(--color-muted-foreground)]">
                    {t("reviewCount", { count: product.seller.rating.count })}
                  </span>
                </p>
              ) : null}
              <p className="mt-1 flex items-center gap-1.5 text-sm text-[var(--color-muted-foreground)]">
                <MapPin aria-hidden="true" className="size-3.5 shrink-0" />
                {product.seller.area}, {product.seller.region}
              </p>

              {/* The strongest thing a buyer can be told: not an anonymous
                  account, a place with an address, and here is the page. */}
              {product.seller.workshop ? (
                <Link
                  href={`/${product.seller.workshop.area_slug}/${product.seller.workshop.slug}`}
                  className="mt-3 flex items-start gap-2 rounded-xl bg-[var(--color-visit-bg)] p-3 text-sm text-[var(--color-visit)] hover:underline"
                >
                  <BadgeCheck aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
                  <span>{t("alsoATrainingWorkshop", { name: product.seller.workshop.name })}</span>
                </Link>
              ) : null}

              {product.seller.about ? (
                <p className="mt-3 whitespace-pre-line text-sm leading-relaxed text-[var(--color-muted-foreground)]">
                  {product.seller.about}
                </p>
              ) : null}

              <Button asChild variant="outline" className="mt-4 w-full">
                <Link href={`/marketplace/seller/${product.seller.id}`}>
                  <Store aria-hidden="true" />
                  {t("seeTheirShop")}
                </Link>
              </Button>
            </CardContent>
          </Card>

          {product.availability === "sold_out" ? (
            <Card>
              <CardContent className="pt-5">
                <p className="text-sm font-semibold">{t("soldOutTitle")}</p>
                <p className="mt-1.5 text-sm leading-relaxed text-[var(--color-muted-foreground)]">
                  {t("soldOutBody")}
                </p>
              </CardContent>
            </Card>
          ) : null}

          {/* A client subtree, so its strings have to be handed over
              explicitly. Without the provider the panel throws and takes the
              whole page down with it — the product rendered its title from
              generateMetadata and then 500'd. */}
          <ClientMessages namespaces={MARKETPLACE_CLIENT_NAMESPACES}>
            {product.buy_online && product.price ? (
              <BuyNow
                productId={product.id}
                price={product.price}
                sellerName={product.seller.business_name}
              />
            ) : null}
            <AskSeller productId={product.id} sellerName={product.seller.business_name} />
            <ProductViewBeacon productId={product.id} />
          </ClientMessages>

          {/* Said once, plainly, where the money question actually arises.
              Without Buy now, paying is between the two of them, and leaving
              that to be discovered is how a first purchase goes wrong. */}
          <p className="px-1 text-xs leading-relaxed text-[var(--color-muted-foreground)]">
            {product.buy_online
              ? t("paymentNoticeOnline", { brandShort: BRAND })
              : t("paymentNotice", { brandShort: BRAND })}
          </p>
        </aside>
      </div>

      {alsoFromSeller.length ? (
        <section className="mt-12">
          <h2 className="text-lg font-extrabold tracking-[-0.025em]">
            {t("alsoFrom", { seller: product.seller.business_name })}
          </h2>
          <div className="mt-4 grid grid-cols-2 gap-3.5 sm:gap-4 lg:grid-cols-4">
            {alsoFromSeller.map((item) => (
              <ProductTile key={item.id} product={item} />
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
