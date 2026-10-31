/**
 * Where Paystack sends a buyer back after paying for a product.
 *
 * Nobody's order is in the HTML: the browser asks the API, which shows an
 * order only to the browser that made it, and confirms the payment with
 * Paystack on the way.
 */

import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

import { OrderStatus } from "@/components/marketplace/OrderStatus";
import { ClientMessages } from "@/i18n/ClientMessages";
import { MARKETPLACE_CLIENT_NAMESPACES } from "@/i18n/namespaces";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Marketplace");
  return { title: t("orderTitle"), robots: { index: false, follow: false } };
}

export default async function OrderPage({ params }: { params: Promise<{ reference: string }> }) {
  const { reference } = await params;
  return (
    <div className="app-shell max-w-xl py-8 pb-14">
      <ClientMessages namespaces={MARKETPLACE_CLIENT_NAMESPACES}>
        <OrderStatus reference={reference} />
      </ClientMessages>
    </div>
  );
}
