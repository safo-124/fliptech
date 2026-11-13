"use client";

import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useCallback } from "react";

import { ChatThread } from "@/components/account/ChatThread";
import { getChat, reportChat, sendChat, shareMyNumber, type ChatReportReason } from "@/lib/account-api";

/** A person's chat with a shop or a workshop, from their account. */
export function BuyerChat({ id }: { id: number }) {
  const t = useTranslations("Account");
  const load = useCallback(() => getChat(id), [id]);
  const send = useCallback((body: string) => sendChat(id, body), [id]);
  const share = useCallback(() => shareMyNumber(id), [id]);
  const report = useCallback(
    (reason: ChatReportReason, details: string) => reportChat(id, reason, details),
    [id],
  );
  return (
    <ChatThread
      side="buyer"
      load={load}
      send={send}
      share={share}
      report={report}
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
