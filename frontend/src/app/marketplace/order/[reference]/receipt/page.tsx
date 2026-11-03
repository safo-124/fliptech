import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

import { OrderReceipt } from "@/components/marketplace/OrderReceipt";
import { ClientMessages } from "@/i18n/ClientMessages";
import { MARKETPLACE_CLIENT_NAMESPACES } from "@/i18n/namespaces";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Marketplace");
  return { title: t("receiptTitle"), robots: { index: false, follow: false } };
}

export default async function ReceiptPage({ params }: { params: Promise<{ reference: string }> }) {
  const { reference } = await params;
  return (
    <div className="app-shell max-w-2xl py-8 pb-14">
      <ClientMessages namespaces={MARKETPLACE_CLIENT_NAMESPACES}>
        <OrderReceipt reference={reference} />
      </ClientMessages>
    </div>
  );
}
