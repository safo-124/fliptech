"use client";

/**
 * The floating messages button: the Fliiptech mark in a round button at the
 * bottom right of every page, with a red count of unread messages, for
 * anybody signed in who has a chat, and always for a shop or a workshop
 * (customers write to them first).
 *
 * A tap opens a panel with a tab for each role this login has (rules in
 * lib/floating-messages.ts): Buying, a person's chats with shops and
 * workshops; Selling, the shop's inbox; Teaching, the workshop's. One role,
 * no tabs. It opens on the tab with people waiting on a reply.
 *
 * On a computer a chat opens inside the panel, to read and reply on the
 * spot; on a phone it opens the chat's own page, where the keyboard has room.
 * Blocking, reporting and sharing a number work in both.
 *
 * Light on data: the count is two numbers per role (backend UnreadView),
 * asked for once a minute while the page is in view and at once when it
 * comes back; the lists only while the panel is open. Signed out, it asks
 * once and stays away. The browser tab's title carries the count too.
 */

import { ArrowLeft, ArrowRight, Loader2, X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState } from "react";

import { ChatThread } from "@/components/account/ChatThread";
import { WatchingMark } from "@/components/messages/WatchingMark";
import {
  blockChat,
  blockInboxChat,
  getChat,
  getChatCounts,
  getChats,
  getInbox,
  getInboxChat,
  reportChat,
  reportInboxChat,
  sendChat,
  sendInboxChat,
  shareInboxNumber,
  shareMyNumber,
  type ChatReportReason,
  type ChatRole,
  type ChatSummary,
} from "@/lib/account-api";
import {
  firstTab,
  forTab,
  hiddenOn,
  inOrder,
  topicOf,
  totalUnread,
  waitsOnYou,
  withCount,
  type Role,
} from "@/lib/floating-messages";
import { SESSION_CHANGED, SIGNED_OUT } from "@/lib/sign-in";

import styles from "./FloatingMessages.module.css";

const COUNT_MS = 60_000;
const LIST_MS = 20_000;
const LAST_TAB = "fliiptech:messages-tab";
/** From here a chat opens inside the panel; below it, on its own page. */
const WIDE = "(min-width: 640px)";

function readLastTab(): Role | null {
  try {
    const value = window.localStorage.getItem(LAST_TAB);
    return value === "buying" || value === "selling" || value === "teaching" ? value : null;
  } catch {
    return null;
  }
}

function rememberTab(role: Role) {
  try {
    window.localStorage.setItem(LAST_TAB, role);
  } catch {
    // A private window: the panel just opens on the first tab next time.
  }
}

const chatPath = (role: Role, id: number) => (role === "buying" ? `/account/chats/${id}` : `/inbox/${id}`);
const visible = () => document.visibilityState === "visible";

export function FloatingMessages() {
  const t = useTranslations("FloatingMessages");
  const path = usePathname() ?? "/";
  const [roles, setRoles] = useState<ChatRole[]>([]);
  // The page the panel was opened on: moving to another page closes it.
  const [openOn, setOpenOn] = useState<string | null>(null);
  const [tab, setTab] = useState<Role | null>(null);
  const [buying, setBuying] = useState<ChatSummary[] | null>(null);
  const [inbox, setInbox] = useState<ChatSummary[] | null>(null);
  const [chatId, setChatId] = useState<number | null>(null);
  const button = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);

  const open = openOn === path;
  const total = totalUnread(roles);
  const hasRoles = roles.length > 0;

  const refreshCounts = useCallback(() => {
    getChatCounts()
      .then((answer) => setRoles(answer.roles))
      .catch(() => {});
  }, []);

  const loadList = useCallback((role: Role) => {
    if (role === "buying") {
      getChats()
        .then((answer) => setBuying(answer.results))
        .catch(() => setBuying((now) => now ?? []));
    } else {
      getInbox()
        .then((answer) => setInbox(answer.results))
        .catch(() => setInbox((now) => now ?? []));
    }
  }, []);

  // Who is signed in, now and whenever that changes.
  useEffect(() => {
    refreshCounts();
    const forget = () => {
      setRoles([]);
      setOpenOn(null);
      setChatId(null);
      setBuying(null);
      setInbox(null);
    };
    window.addEventListener(SESSION_CHANGED, refreshCounts);
    window.addEventListener(SIGNED_OUT, forget);
    return () => {
      window.removeEventListener(SESSION_CHANGED, refreshCounts);
      window.removeEventListener(SIGNED_OUT, forget);
    };
  }, [refreshCounts]);

  // The count: once a minute while in view, and on coming back to the page.
  useEffect(() => {
    if (!hasRoles) return;
    const tick = () => visible() && refreshCounts();
    const timer = window.setInterval(tick, COUNT_MS);
    document.addEventListener("visibilitychange", tick);
    window.addEventListener("focus", tick);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", tick);
      window.removeEventListener("focus", tick);
    };
  }, [hasRoles, refreshCounts]);

  // The list on show, kept fresh while the panel is open on it.
  useEffect(() => {
    if (!open || !tab || chatId !== null) return;
    const timer = window.setInterval(() => visible() && loadList(tab), LIST_MS);
    return () => window.clearInterval(timer);
  }, [open, tab, chatId, loadList]);

  // "(2) Fliiptech …" in the browser tab, kept on as pages change the title.
  useEffect(() => {
    const apply = () => {
      const next = withCount(document.title, total);
      if (next !== document.title) document.title = next;
    };
    apply();
    const watcher = new MutationObserver(apply);
    watcher.observe(document.head, { childList: true, subtree: true, characterData: true });
    return () => {
      watcher.disconnect();
      document.title = withCount(document.title, 0);
    };
  }, [total, path]);

  // Escape, or a tap outside, closes it; opening it moves focus into it.
  useEffect(() => {
    if (!open) return;
    panel.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpenOn(null);
        button.current?.focus();
      }
    };
    const onPointer = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!panel.current?.contains(target) && !button.current?.contains(target)) setOpenOn(null);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointer);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointer);
    };
  }, [open]);

  if (!hasRoles || hiddenOn(path)) return null;

  const ordered = inOrder(roles);
  const current = ordered.find((entry) => entry.role === tab) ?? ordered[0];
  const source = current.role === "buying" ? buying : inbox;
  const chats = source ? forTab(source, current.role) : null;

  function toggle() {
    if (open) {
      setOpenOn(null);
      return;
    }
    const chosen = firstTab(roles, readLastTab()) ?? "buying";
    setTab(chosen);
    setChatId(null);
    setOpenOn(path);
    loadList(chosen);
    refreshCounts();
  }

  function choose(role: Role) {
    setTab(role);
    setChatId(null);
    rememberTab(role);
    loadList(role);
  }

  function backToList() {
    setChatId(null);
    loadList(current.role);
    refreshCounts();
  }

  return (
    <>
      {open ? (
        <div
          ref={panel}
          id="floating-messages"
          role="dialog"
          aria-labelledby="floating-messages-title"
          tabIndex={-1}
          className="fixed inset-x-2 top-[4.5rem] bottom-[calc(10.25rem+env(safe-area-inset-bottom))] z-[950] flex flex-col overflow-hidden rounded-2xl border border-[var(--color-border)] bg-[var(--color-card)] shadow-[var(--shadow-lg)] outline-none sm:inset-x-auto sm:right-4 sm:top-auto sm:h-[min(34rem,calc(100dvh-14rem))] sm:w-[23rem] lg:bottom-24 lg:right-6 lg:h-[min(34rem,calc(100dvh-9rem))]"
        >
          {chatId !== null ? (
            <PanelChat id={chatId} role={current.role} onBack={backToList} backLabel={t("back")} />
          ) : (
            <>
              <div className="flex items-center justify-between gap-2 px-4 pb-2 pt-3">
                <h2 id="floating-messages-title" className="text-base font-bold">
                  {t("title")}
                </h2>
                <button
                  type="button"
                  onClick={() => {
                    setOpenOn(null);
                    button.current?.focus();
                  }}
                  aria-label={t("close")}
                  className="grid size-9 place-items-center rounded-full hover:bg-[var(--color-muted)]"
                >
                  <X aria-hidden="true" className="size-5" />
                </button>
              </div>

              {ordered.length > 1 ? (
                <div
                  role="tablist"
                  aria-label={t("tabsLabel")}
                  className="mx-4 mb-2 flex gap-1 rounded-xl bg-[var(--color-muted)] p-1"
                >
                  {ordered.map((entry) => {
                    const on = entry.role === current.role;
                    return (
                      <button
                        key={entry.role}
                        type="button"
                        role="tab"
                        aria-selected={on}
                        onClick={() => choose(entry.role)}
                        className={`flex min-h-9 flex-1 items-center justify-center gap-1.5 rounded-lg px-2 text-xs font-semibold transition-colors ${
                          on
                            ? "bg-[var(--color-card)] text-[var(--color-foreground)] shadow-sm"
                            : "text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]"
                        }`}
                      >
                        {t(`tab.${entry.role}`)}
                        {entry.unread ? (
                          <span className="grid min-w-4 place-items-center rounded-full bg-[var(--color-brand-pink)] px-1 text-[10px] font-bold leading-4 text-white">
                            {entry.unread > 99 ? "99+" : entry.unread}
                            <span className="sr-only"> {t("unread")}</span>
                          </span>
                        ) : null}
                      </button>
                    );
                  })}
                </div>
              ) : null}

              <div role={ordered.length > 1 ? "tabpanel" : undefined} className="min-h-0 flex-1 overflow-y-auto border-t border-[var(--color-border)]">
                {chats === null ? (
                  <p className="grid place-items-center py-10" aria-label={t("loading")}>
                    <Loader2 aria-hidden="true" className="size-5 animate-spin text-[var(--color-muted-foreground)]" />
                  </p>
                ) : chats.length === 0 ? (
                  <p className="px-4 py-10 text-center text-sm text-[var(--color-muted-foreground)]">
                    {t(`empty.${current.role}`)}
                  </p>
                ) : (
                  <ul>
                    {chats.map((chat) => (
                      <ChatRow
                        key={chat.id}
                        chat={chat}
                        role={current.role}
                        you={(text) => t("you", { text })}
                        sharedNumber={t("sharedNumber")}
                        onOpen={(event) => {
                          // On a computer, read it here; on a phone, on its page.
                          if (!window.matchMedia(WIDE).matches) return;
                          event.preventDefault();
                          setChatId(chat.id);
                        }}
                      />
                    ))}
                  </ul>
                )}
              </div>

              <div className="flex items-center justify-between gap-2 border-t border-[var(--color-border)] px-4 py-2.5 text-xs">
                <span className="text-[var(--color-muted-foreground)]">
                  {current.role !== "buying" && current.waiting > 0 ? t("waiting", { count: current.waiting }) : null}
                </span>
                <Link
                  href={current.role === "buying" ? "/account#messages" : "/inbox"}
                  className="inline-flex items-center gap-1 font-semibold text-[var(--color-brand)] hover:underline"
                >
                  {current.role === "buying" ? t("allBuying") : t("allInbox")}
                  <ArrowRight aria-hidden="true" className="size-3.5" />
                </Link>
              </div>
            </>
          )}
        </div>
      ) : null}

      <button
        ref={button}
        type="button"
        onClick={toggle}
        aria-expanded={open}
        aria-controls={open ? "floating-messages" : undefined}
        aria-label={t("open", { count: total })}
        className="fixed bottom-[calc(6rem+env(safe-area-inset-bottom))] right-4 z-[950] grid size-14 place-items-center rounded-full border border-[var(--color-border)] bg-[var(--color-card)] shadow-[var(--shadow-lg)] transition-transform hover:-translate-y-0.5 lg:bottom-6 lg:right-6"
      >
        {/* The mark with eyes that follow the pointer, glance at a new
            message and look up into the open panel (WatchingMark.tsx). */}
        <WatchingMark className="size-10" looking={open ? "panel" : null} count={total} />
        {total ? (
          <span
            key={total}
            aria-hidden="true"
            className={`absolute -right-1 -top-1 grid min-w-5 place-items-center rounded-full border-2 border-[var(--color-card)] bg-[var(--color-brand-pink)] px-1 text-[11px] font-bold leading-4 text-white ${styles.pop}`}
          >
            {total > 99 ? "99+" : total}
          </span>
        ) : null}
      </button>
    </>
  );
}

function ChatRow({
  chat,
  role,
  you,
  sharedNumber,
  onOpen,
}: {
  chat: ChatSummary;
  role: Role;
  you: (text: string) => string;
  sharedNumber: string;
  onOpen: (event: React.MouseEvent<HTMLAnchorElement>) => void;
}) {
  const topic = topicOf(chat);
  const last = chat.last;
  const mine = last ? last.sender === (role === "buying" ? "buyer" : "seller") : false;
  const text = !last ? "" : last.kind === "phone" ? sharedNumber : last.body;
  const waiting = waitsOnYou(chat, role);
  return (
    <li className="border-b border-[var(--color-border)] last:border-b-0">
      <Link
        href={chatPath(role, chat.id)}
        onClick={onOpen}
        className="flex items-start gap-3 px-4 py-3 hover:bg-[var(--color-muted)]"
      >
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5">
            <span className={`truncate text-sm ${chat.unread || waiting ? "font-bold" : "font-semibold"}`}>
              {chat.with.name}
            </span>
            {topic ? (
              <span className="max-w-[45%] shrink-0 truncate rounded-md bg-[var(--color-muted)] px-1.5 py-0.5 text-[11px] font-semibold text-[var(--color-muted-foreground)]">
                {topic}
              </span>
            ) : null}
          </span>
          <span
            className={`mt-0.5 block truncate text-xs ${
              chat.unread ? "text-[var(--color-foreground)]" : "text-[var(--color-muted-foreground)]"
            }`}
          >
            {mine ? you(text) : text}
          </span>
        </span>
        {chat.unread ? (
          <span className="mt-1 grid min-w-5 place-items-center rounded-full bg-[var(--color-brand-pink)] px-1 text-[11px] font-bold leading-4 text-white">
            {chat.unread}
          </span>
        ) : null}
      </Link>
    </li>
  );
}

/** One chat inside the panel: a buyer's own, or the shop's or workshop's. */
function PanelChat({
  id,
  role,
  onBack,
  backLabel,
}: {
  id: number;
  role: Role;
  onBack: () => void;
  backLabel: string;
}) {
  const business = role !== "buying";
  const load = useCallback(() => (business ? getInboxChat(id) : getChat(id)), [business, id]);
  const send = useCallback((body: string) => (business ? sendInboxChat(id, body) : sendChat(id, body)), [business, id]);
  const share = useCallback(() => (business ? shareInboxNumber(id) : shareMyNumber(id)), [business, id]);
  const report = useCallback(
    (reason: ChatReportReason, details: string) =>
      business ? reportInboxChat(id, reason, details) : reportChat(id, reason, details),
    [business, id],
  );
  const block = useCallback((on: boolean) => (business ? blockInboxChat(id, on) : blockChat(id, on)), [business, id]);
  return (
    <ChatThread
      fill
      side={business ? "seller" : "buyer"}
      load={load}
      send={send}
      share={share}
      report={report}
      block={block}
      header={
        <button
          type="button"
          onClick={onBack}
          aria-label={backLabel}
          className="grid size-10 shrink-0 place-items-center rounded-full hover:bg-[var(--color-muted)]"
        >
          <ArrowLeft aria-hidden="true" className="size-5" />
        </button>
      }
    />
  );
}
