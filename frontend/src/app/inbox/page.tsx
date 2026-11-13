import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

import { InboxList } from "@/components/account/Inbox";
import { ClientMessages } from "@/i18n/ClientMessages";
import { INBOX_CLIENT_NAMESPACES } from "@/i18n/namespaces";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Chat");
  return { title: t("inboxTitle"), robots: { index: false } };
}

/** /inbox: a shop's and a workshop's messages. The texts link here. */
export default function InboxPage() {
  return (
    <div className="app-shell max-w-3xl py-6">
      <ClientMessages namespaces={INBOX_CLIENT_NAMESPACES}>
        <InboxList standalone />
      </ClientMessages>
    </div>
  );
}
