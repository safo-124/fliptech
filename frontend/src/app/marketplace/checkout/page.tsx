import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

import { CheckoutAll } from "@/components/marketplace/CheckoutAll";
import { ClientMessages } from "@/i18n/ClientMessages";
import { MARKETPLACE_CLIENT_NAMESPACES } from "@/i18n/namespaces";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Marketplace");
  return { title: t("checkoutAllTitle"), robots: { index: false, follow: false } };
}

/** One checkout for everything in the bag, seller by seller. */
export default function CheckoutPage() {
  return (
    <div className="app-shell max-w-2xl py-8 pb-14">
      <ClientMessages namespaces={MARKETPLACE_CLIENT_NAMESPACES}>
        <CheckoutAll />
      </ClientMessages>
    </div>
  );
}
