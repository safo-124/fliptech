/** Products saved for later in this browser. */

import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

import { SavedView } from "@/components/marketplace/SavedView";
import { ClientMessages } from "@/i18n/ClientMessages";
import { MARKETPLACE_CLIENT_NAMESPACES } from "@/i18n/namespaces";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Marketplace");
  return { title: t("savedTitle"), robots: { index: false, follow: false } };
}

export default function SavedPage() {
  return (
    <div className="app-shell py-8 pb-14">
      <ClientMessages namespaces={MARKETPLACE_CLIENT_NAMESPACES}>
        <SavedView />
      </ClientMessages>
    </div>
  );
}
