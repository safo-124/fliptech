/** Paying for several sellers' parts of the basket in one payment. */

import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

import { CheckoutAll } from "@/components/basket/CheckoutAll";
import { ClientMessages } from "@/i18n/ClientMessages";
import { MARKETPLACE_CLIENT_NAMESPACES } from "@/i18n/namespaces";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Basket");
  return { title: t("checkoutTitle"), robots: { index: false, follow: false } };
}

export default async function CheckoutAllRoute() {
  const t = await getTranslations("Basket");
  return (
    <div className="app-shell max-w-2xl py-8 pb-14">
      <h1 className="mb-4 text-2xl font-extrabold tracking-[-0.02em]">{t("checkoutTitle")}</h1>
      <ClientMessages namespaces={MARKETPLACE_CLIENT_NAMESPACES}>
        <CheckoutAll />
      </ClientMessages>
    </div>
  );
}
