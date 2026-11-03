"use client";

import { ArrowLeft, MessagesSquare } from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";

import { ChatThread } from "@/components/account/ChatThread";
import type { ChatSummary } from "@/lib/account-api";
import { getSellerChat, getSellerChats, sendSellerChat } from "@/lib/seller-api";

/** The seller's "Chats" tab: buyers' messages, newest first, and a thread. */
export function SellerChatsTab() {
  const t = useTranslations("SellerDashboard");
  const [chats, setChats] = useState<ChatSummary[] | null>(null);
  const [open, setOpen] = useState<number | null>(null);

  const reload = useCallback(() => {
    getSellerChats()
      .then((found) => setChats(found.results))
      .catch(() => setChats([]));
  }, []);
  useEffect(reload, [reload]);

  const load = useCallback(() => getSellerChat(open ?? 0), [open]);
  const send = useCallback((body: string) => sendSellerChat(open ?? 0, body), [open]);

  if (open !== null) {
    return (
      <ChatThread
        side="seller"
        load={load}
        send={send}
        header={
          <button
            type="button"
            onClick={() => {
              setOpen(null);
              reload();
            }}
            aria-label={t("chatsBack")}
            className="grid size-10 place-items-center rounded-full hover:bg-[var(--color-muted)]"
          >
            <ArrowLeft aria-hidden="true" className="size-5" />
          </button>
        }
      />
    );
  }

  return (
    <section aria-labelledby="seller-chats" className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-card)] p-5">
      <h2 id="seller-chats" className="flex items-center gap-2 text-lg font-bold">
        <MessagesSquare aria-hidden="true" className="size-5 text-[var(--color-brand)]" />
        {t("tabChats")}
      </h2>
      <p className="mt-1 text-sm text-[var(--color-muted-foreground)]">{t("chatsLead")}</p>
      {chats === null ? (
        <p className="mt-4 text-sm text-[var(--color-muted-foreground)]">…</p>
      ) : chats.length ? (
        <ul className="mt-3 divide-y divide-[var(--color-border)]">
          {chats.map((chat) => (
            <li key={chat.id}>
              <button
                type="button"
                onClick={() => setOpen(chat.id)}
                className="flex w-full items-center gap-3 py-3 text-left"
              >
                <span className="grid size-10 shrink-0 place-items-center rounded-full bg-[var(--color-brand-soft)] text-sm font-bold text-[var(--color-brand)]">
                  {chat.with.name.slice(0, 1).toUpperCase()}
                </span>
                <span className="min-w-0 flex-1">
                  <span className={`block truncate text-sm ${chat.unread ? "font-bold" : "font-semibold"}`}>
                    {chat.with.name}
                  </span>
                  <span className="block truncate text-xs text-[var(--color-muted-foreground)]">
                    {chat.last?.body}
                  </span>
                </span>
                {chat.unread ? (
                  <span className="rounded-full bg-[var(--color-brand)] px-2 py-0.5 text-[11px] font-extrabold text-white">
                    {chat.unread}
                  </span>
                ) : null}
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-4 text-sm text-[var(--color-muted-foreground)]">{t("chatsNone")}</p>
      )}
    </section>
  );
}
