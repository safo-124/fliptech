/**
 * A seller's shop front: who they are, and everything of theirs on sale.
 *
 * A seller nobody may see is a 404 from the API rather than an empty shop,
 * because an empty shop confirms the account exists. This page simply
 * follows that.
 */

import { ArrowLeft, BadgeCheck, MapPin } from "lucide-react";
import type { Metadata } from "next";
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

  const { seller, products } = shop;

  return (
    <div className="app-shell py-6 pb-14">
      <Button asChild variant="ghost" size="sm" className="-ml-2 mb-4">
        <Link href="/marketplace">
          <ArrowLeft aria-hidden="true" />
          {t("backToMarketplace")}
        </Link>
      </Button>

      <header className="mb-7">
        <h1 className="text-2xl font-extrabold tracking-[-0.03em] sm:text-3xl">
          {seller.business_name}
        </h1>
        <p className="mt-2 flex items-center gap-1.5 text-sm text-[var(--color-muted-foreground)]">
          <MapPin aria-hidden="true" className="size-4 shrink-0" />
          {seller.area}, {seller.region}
        </p>
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
    </div>
  );
}
