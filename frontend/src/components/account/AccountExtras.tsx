"use client";

import { BellRing, ChevronRight, MessageSquare, Trash2 } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";

import {
  deleteSavedSearch,
  getChats,
  getSavedSearches,
  type ChatSummary,
  type SavedSearch,
} from "@/lib/account-api";

/** Messages with sellers, and saved searches, on the account page. */
export function AccountExtras() {
  const t = useTranslations("Account");
  const [chats, setChats] = useState<ChatSummary[] | null>(null);
  const [searches, setSearches] = useState<SavedSearch[] | null>(null);

  useEffect(() => {
    let live = true;
    getChats()
      .then((found) => live && setChats(found.results))
      .catch(() => live && setChats([]));
    getSavedSearches()
      .then((found) => live && setSearches(found.results))
      .catch(() => live && setSearches([]));
    return () => {
      live = false;
    };
  }, []);

  const unread = (chats ?? []).reduce((sum, chat) => sum + chat.unread, 0);

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <section
        aria-labelledby="account-chats"
        className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-card)] p-5"
      >
        <h2 id="account-chats" className="flex items-center gap-2 text-base font-bold">
          <MessageSquare aria-hidden="true" className="size-4 text-[var(--color-brand)]" />
          {t("chatsTitle")}
          {unread ? (
            <span className="rounded-full bg-[var(--color-brand)] px-2 py-0.5 text-[11px] font-extrabold text-white">
              {unread}
            </span>
          ) : null}
        </h2>
        {chats === null ? (
          <p className="mt-3 text-sm text-[var(--color-muted-foreground)]">…</p>
        ) : chats.length ? (
          <ul className="mt-3 divide-y divide-[var(--color-border)]">
            {chats.slice(0, 5).map((chat) => (
              <li key={chat.id}>
                <Link href={`/account/chats/${chat.id}`} className="flex items-center gap-3 py-2.5">
                  <span className="min-w-0 flex-1">
                    <span className={`block truncate text-sm ${chat.unread ? "font-bold" : "font-semibold"}`}>
                      {chat.with.name}
                    </span>
                    <span className="block truncate text-xs text-[var(--color-muted-foreground)]">
                      {chat.last?.sender === "buyer" ? `${t("chatsYou")}: ` : ""}
                      {chat.last?.body}
                    </span>
                  </span>
                  <ChevronRight aria-hidden="true" className="size-4 text-[var(--color-muted-foreground)]" />
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-3 text-sm text-[var(--color-muted-foreground)]">{t("chatsNone")}</p>
        )}
        {chats && chats.length > 5 ? (
          <Link href="/account/chats" className="mt-2 inline-block text-sm font-semibold text-[var(--color-brand)]">
            {t("chatsAll")}
          </Link>
        ) : null}
      </section>

      <section
        aria-labelledby="account-searches"
        className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-card)] p-5"
      >
        <h2 id="account-searches" className="flex items-center gap-2 text-base font-bold">
          <BellRing aria-hidden="true" className="size-4 text-[var(--color-brand)]" />
          {t("searchesTitle")}
        </h2>
        {searches === null ? (
          <p className="mt-3 text-sm text-[var(--color-muted-foreground)]">…</p>
        ) : searches.length ? (
          <ul className="mt-3 divide-y divide-[var(--color-border)]">
            {searches.map((search) => (
              <li key={search.id} className="flex items-center gap-2 py-2">
                <Link href={search.path} className="min-w-0 flex-1 truncate text-sm font-semibold hover:underline">
                  {search.label}
                </Link>
                <button
                  type="button"
                  aria-label={t("searchesDelete", { label: search.label })}
                  className="grid size-9 place-items-center rounded-full text-[var(--color-muted-foreground)] hover:bg-[var(--color-muted)]"
                  onClick={() => {
                    setSearches((now) => (now ?? []).filter((row) => row.id !== search.id));
                    void deleteSavedSearch(search.id).catch(() => undefined);
                  }}
                >
                  <Trash2 aria-hidden="true" className="size-4" />
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-3 text-sm text-[var(--color-muted-foreground)]">{t("searchesNone")}</p>
        )}
      </section>
    </div>
  );
}
