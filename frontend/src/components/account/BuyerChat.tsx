"use client";

import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useCallback } from "react";

import { ChatThread } from "@/components/account/ChatThread";
import { getChat, sendChat } from "@/lib/account-api";

export function BuyerChat({ id }: { id: number }) {
  const t = useTranslations("Account");
  const load = useCallback(() => getChat(id), [id]);
  const send = useCallback((body: string) => sendChat(id, body), [id]);
  return (
    <ChatThread
      side="buyer"
      load={load}
      send={send}
      header={
        <Link
          href="/account"
          aria-label={t("chatBack")}
          className="grid size-10 place-items-center rounded-full hover:bg-[var(--color-muted)]"
        >
          <ArrowLeft aria-hidden="true" className="size-5" />
        </Link>
      }
    />
  );
}
