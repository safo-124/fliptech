"use client";

import { ArrowLeft, GraduationCap, Loader2, MessagesSquare, Store } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";

import { ChatThread } from "@/components/account/ChatThread";
import {
  getAccount,
  getInbox,
  getInboxChat,
  reportInboxChat,
  sendInboxChat,
  shareInboxNumber,
  type ChatReportReason,
  type ChatSummary,
} from "@/lib/account-api";
import { TrainerApiError } from "@/lib/trainer-fetch";

/** How often the list asks for new chats while it is on screen. */
const POLL_MS = 15000;

type T = ReturnType<typeof useTranslations<"Chat">>;

/**
 * Why the inbox said no: nobody is signed in (send them to sign in and back),
 * or somebody is but holds no shop or workshop.
 */
async function refusal(error: unknown): Promise<"signed-out" | "not-business" | "failed"> {
  if (!(error instanceof TrainerApiError) || (error.status !== 401 && error.status !== 403)) {
    return "failed";
  }
  const session = await getAccount().catch(() => null);
  return session?.authenticated ? "not-business" : "signed-out";
}

function signInFor(path: string) {
  return `/account?next=${encodeURIComponent(path)}`;
}

function when(iso: string) {
  const date = new Date(iso);
  const today = new Date().toDateString() === date.toDateString();
  return today
    ? date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })
    : date.toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

function preview(chat: ChatSummary, t: T) {
  const last = chat.last;
  if (!last) return "";
  const mine = last.sender === "seller";
  // "You shared your number" already says who.
  if (last.kind === "phone") return mine ? t("phoneYours") : t("phoneShared");
  const text = last.kind === "enquiry" && last.course ? t("enquiry", { title: last.course.title }) : last.body;
  return mine ? `${t("you")}: ${text}` : text;
}

function NotBusiness({ t }: { t: T }) {
  return (
    <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-card)] p-5 text-sm">
      <p>{t("inboxNotBusiness")}</p>
      <Link href="/account" className="mt-3 inline-block font-semibold text-[var(--color-brand)] hover:underline">
        {t("inboxGoAccount")}
      </Link>
    </div>
  );
}

/**
 * The business inbox: every chat for the shop and the workshop this login
 * holds, newest first, so somebody who teaches and sells answers in one
 * place. On /inbox (`standalone`) and inside the seller's and the trainer's
 * workspaces. A row opens /inbox/<id>, the address the texts link to.
 */
export function InboxList({ standalone = false }: { standalone?: boolean }) {
  const t = useTranslations("Chat");
  const router = useRouter();
  const [chats, setChats] = useState<ChatSummary[] | null>(null);
  const [problem, setProblem] = useState<"not-business" | "failed" | null>(null);

  useEffect(() => {
    let active = true;
    const load = (first: boolean) => {
      if (!first && document.visibilityState !== "visible") return;
      getInbox()
        .then((found) => {
          if (!active) return;
          setChats(found.results);
          setProblem(null);
        })
        .catch(async (error: unknown) => {
          // A poll that fails keeps what is on screen; only the first load
          // decides what the page shows instead.
          if (!first) return;
          const why = await refusal(error);
          if (!active) return;
          if (why === "signed-out" && standalone) router.replace(signInFor("/inbox"));
          else setProblem(why === "not-business" ? "not-business" : "failed");
        });
    };
    load(true);
    const timer = window.setInterval(() => load(false), POLL_MS);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [router, standalone]);

  const Heading = standalone ? "h1" : "h2";
  // Which shop or workshop a chat is with matters only to someone who has both.
  const mixed = chats ? new Set(chats.map((chat) => `${chat.business.kind}${chat.business.id}`)).size > 1 : false;

  return (
    <section
      aria-labelledby="inbox-title"
      className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-card)] p-5"
    >
      <Heading
        id="inbox-title"
        className={`flex items-center gap-2 font-bold ${standalone ? "text-2xl tracking-[-0.03em]" : "text-lg"}`}
      >
        <MessagesSquare aria-hidden="true" className="size-5 text-[var(--color-brand)]" />
        {t("inboxTitle")}
      </Heading>
      <p className="mt-1 text-sm text-[var(--color-muted-foreground)]">{t("inboxLead")}</p>

      {problem === "not-business" ? (
        <div className="mt-4">
          <NotBusiness t={t} />
        </div>
      ) : problem === "failed" ? (
        <p role="alert" className="mt-4 text-sm text-[var(--color-warn)]">
          {t("inboxFailed")}
        </p>
      ) : chats === null ? (
        <Loader2 aria-hidden="true" className="mx-auto mt-6 size-5 animate-spin text-[var(--color-muted-foreground)]" />
      ) : chats.length ? (
        <ul className="mt-3 divide-y divide-[var(--color-border)]">
          {chats.map((chat) => (
            <li key={chat.id}>
              <Link href={`/inbox/${chat.id}`} className="flex items-center gap-3 py-3">
                <span className="grid size-10 shrink-0 place-items-center rounded-full bg-[var(--color-brand-soft)] text-sm font-bold text-[var(--color-brand)]">
                  {chat.with.name.slice(0, 1).toUpperCase()}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline justify-between gap-2">
                    <span className={`truncate text-sm ${chat.unread ? "font-bold" : "font-semibold"}`}>
                      {chat.with.name}
                    </span>
                    <span className="shrink-0 text-[11px] text-[var(--color-muted-foreground)]">
                      {when(chat.last_message_at)}
                    </span>
                  </span>
                  {mixed ? (
                    <span className="flex items-center gap-1 text-[11px] text-[var(--color-muted-foreground)]">
                      {chat.kind === "workshop" ? (
                        <GraduationCap aria-hidden="true" className="size-3" />
                      ) : (
                        <Store aria-hidden="true" className="size-3" />
                      )}
                      {chat.business.name}
                    </span>
                  ) : null}
                  <span className="block truncate text-xs text-[var(--color-muted-foreground)]">
                    {preview(chat, t)}
                  </span>
                </span>
                {chat.unread ? (
                  <span className="rounded-full bg-[var(--color-brand)] px-2 py-0.5 text-[11px] font-extrabold text-white">
                    {chat.unread}
                  </span>
                ) : null}
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-4 text-sm text-[var(--color-muted-foreground)]">{t("inboxNone")}</p>
      )}
    </section>
  );
}

/** One chat in the business inbox, with the person's name and their messages. */
export function InboxChat({ id }: { id: number }) {
  const t = useTranslations("Chat");
  const router = useRouter();
  const [notBusiness, setNotBusiness] = useState(false);

  const load = useCallback(
    () =>
      getInboxChat(id).catch(async (error: unknown) => {
        const why = await refusal(error);
        if (why === "signed-out") router.replace(signInFor(`/inbox/${id}`));
        else if (why === "not-business") setNotBusiness(true);
        throw error;
      }),
    [id, router],
  );
  const send = useCallback((body: string) => sendInboxChat(id, body), [id]);
  const share = useCallback(() => shareInboxNumber(id), [id]);
  const report = useCallback(
    (reason: ChatReportReason, details: string) => reportInboxChat(id, reason, details),
    [id],
  );

  if (notBusiness) return <NotBusiness t={t} />;
  return (
    <ChatThread
      side="seller"
      load={load}
      send={send}
      share={share}
      report={report}
      header={
        <Link
          href="/inbox"
          aria-label={t("allMessages")}
          className="grid size-10 place-items-center rounded-full hover:bg-[var(--color-muted)]"
        >
          <ArrowLeft aria-hidden="true" className="size-5" />
        </Link>
      }
    />
  );
}
