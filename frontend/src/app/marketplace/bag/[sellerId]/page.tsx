/**
 * One maker's bag: several things, one payment. The bag lives in this
 * browser (lib/bag.ts), so the page is a client view of it.
 */

import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

import { BagView } from "@/components/marketplace/BagView";
import { ClientMessages } from "@/i18n/ClientMessages";
import { MARKETPLACE_CLIENT_NAMESPACES } from "@/i18n/namespaces";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Marketplace");
  return { title: t("bagTitle"), robots: { index: false, follow: false } };
}

export default async function BagPage({ params }: { params: Promise<{ sellerId: string }> }) {
  const { sellerId } = await params;
  return (
    <div className="app-shell max-w-2xl py-8 pb-14">
      <ClientMessages namespaces={MARKETPLACE_CLIENT_NAMESPACES}>
        <BagView sellerId={Number(sellerId)} />
      </ClientMessages>
    </div>
  );
}
