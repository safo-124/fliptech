/**
 * Every shop on the marketplace: /marketplace/shops. Trainers' shops first,
 * then the most items. Each card opens the shop, where everything it sells
 * is listed (/marketplace/seller/<id>).
 */

import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

import { MarketViewSwitch } from "@/components/marketplace/MarketViewSwitch";
import { ShopCard } from "@/components/marketplace/ShopCard";
import { Card } from "@/components/ui/card";
import { getShops } from "@/lib/api";

export const revalidate = 300;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Marketplace");
  return { title: t("shopsMetaTitle"), alternates: { canonical: "/marketplace/shops" } };
}

export default async function ShopsPage() {
  const [shops, t] = await Promise.all([getShops().catch(() => null), getTranslations("Marketplace")]);
  const results = shops?.results ?? [];

  return (
    <div className="app-shell pb-14 pt-6 sm:pt-8">
      <MarketViewSwitch current="shops" />
      <h1 className="text-2xl font-extrabold tracking-[-0.03em] sm:text-3xl">{t("shopsTitle")}</h1>
      <p className="mt-1 max-w-[60ch] text-sm text-[var(--color-muted-foreground)]">{t("shopsBody")}</p>
      {shops === null ? (
        <Card className="mt-6 p-8 text-center">
          <p className="text-sm text-[var(--color-muted-foreground)]">{t("unavailable")}</p>
        </Card>
      ) : results.length === 0 ? (
        <Card className="mt-6 p-8 text-center">
          <p className="text-sm text-[var(--color-muted-foreground)]">{t("shopsNone")}</p>
        </Card>
      ) : (
        <ul className="mt-6 grid grid-cols-2 gap-3.5 sm:grid-cols-3 sm:gap-4 lg:grid-cols-4">
          {results.map((shop) => (
            <li key={shop.id}>
              <ShopCard shop={shop} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
