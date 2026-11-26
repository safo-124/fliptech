/**
 * Where Paystack sends a buyer back after paying several sellers at once.
 * Nothing private is in the HTML: the browser asks the API, which shows the
 * receipt only to the browser (or account) that paid.
 */

import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

import { CheckoutReceipt } from "@/components/basket/CheckoutReceipt";
import { ClientMessages } from "@/i18n/ClientMessages";
import { MARKETPLACE_CLIENT_NAMESPACES } from "@/i18n/namespaces";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Basket");
  return { title: t("receiptTitle"), robots: { index: false, follow: false } };
}

export default async function ReceiptRoute({ params }: { params: Promise<{ reference: string }> }) {
  const { reference } = await params;
  return (
    <div className="app-shell max-w-xl py-8 pb-14">
      <ClientMessages namespaces={MARKETPLACE_CLIENT_NAMESPACES}>
        <CheckoutReceipt reference={reference} />
      </ClientMessages>
    </div>
  );
}
