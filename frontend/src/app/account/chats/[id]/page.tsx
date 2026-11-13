import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { BuyerChat } from "@/components/account/BuyerChat";
import { ClientMessages } from "@/i18n/ClientMessages";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Account");
  return { title: t("chatsTitle"), robots: { index: false } };
}

export default async function ChatPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^\d+$/.test(id)) notFound();
  return (
    <div className="app-shell max-w-3xl py-6">
      <ClientMessages namespaces={["Account", "Chat"]}>
        <BuyerChat id={Number(id)} />
      </ClientMessages>
    </div>
  );
}
