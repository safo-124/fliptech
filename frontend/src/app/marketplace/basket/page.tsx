/**
 * The basket: everything chosen, grouped by seller as the server returns it
 * (backend marketplace/basket.py). The same basket as the app's.
 */

import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

import { BasketPage } from "@/components/basket/BasketPage";
import { ClientMessages } from "@/i18n/ClientMessages";
import { MARKETPLACE_CLIENT_NAMESPACES } from "@/i18n/namespaces";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Basket");
  return { title: t("title"), robots: { index: false, follow: false } };
}

export default async function BasketRoute() {
  const t = await getTranslations("Basket");
  return (
    <div className="app-shell max-w-2xl py-8 pb-14">
      <h1 className="mb-4 text-2xl font-extrabold tracking-[-0.02em]">{t("title")}</h1>
      <ClientMessages namespaces={MARKETPLACE_CLIENT_NAMESPACES}>
        <BasketPage />
      </ClientMessages>
    </div>
  );
}
