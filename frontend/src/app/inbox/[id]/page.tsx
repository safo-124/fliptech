import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { InboxChat } from "@/components/account/Inbox";
import { ClientMessages } from "@/i18n/ClientMessages";
import { INBOX_CLIENT_NAMESPACES } from "@/i18n/namespaces";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Chat");
  return { title: t("inboxTitle"), robots: { index: false } };
}

/** /inbox/<id>: one chat, opened from the inbox or from a text about it. */
export default async function InboxChatPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^\d+$/.test(id)) notFound();
  return (
    <div className="app-shell max-w-3xl py-6">
      <ClientMessages namespaces={INBOX_CLIENT_NAMESPACES}>
        <InboxChat id={Number(id)} />
      </ClientMessages>
    </div>
  );
}
