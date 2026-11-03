"use client";

import { Loader2, Send } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState } from "react";

import type { ChatThread as Thread } from "@/lib/account-api";

/** How often an open chat asks for new messages. */
const POLL_MS = 5000;

/**
 * One chat, for the buyer (account) or the seller (dashboard): the same
 * view with a different side and API. Asks for new messages every few
 * seconds while open and visible; nothing needs a socket.
 */
export function ChatThread({
  side,
  load,
  send,
  header,
}: {
  side: "buyer" | "seller";
  load: () => Promise<Thread>;
  send: (body: string) => Promise<Thread>;
  header?: React.ReactNode;
}) {
  const t = useTranslations("Account");
  const [thread, setThread] = useState<Thread | null>(null);
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const end = useRef<HTMLDivElement>(null);
  const count = thread?.messages.length ?? 0;

  const refresh = useCallback(() => {
    if (document.visibilityState !== "visible") return;
    load()
      .then(setThread)
      .catch(() => undefined);
  }, [load]);

  useEffect(() => {
    load()
      .then(setThread)
      .catch((error: Error) => setProblem(error.message));
    const timer = window.setInterval(refresh, POLL_MS);
    return () => window.clearInterval(timer);
  }, [load, refresh]);

  useEffect(() => {
    end.current?.scrollIntoView({ block: "end" });
  }, [count]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!body.trim()) return;
    setBusy(true);
    setProblem(null);
    try {
      setThread(await send(body.trim()));
      setBody("");
    } catch (error) {
      setProblem(error instanceof Error ? error.message : t("chatFailed"));
    }
    setBusy(false);
  }

  return (
    <div className="flex min-h-[60vh] flex-col rounded-2xl border border-[var(--color-border)] bg-[var(--color-card)]">
      <div className="flex items-center gap-3 border-b border-[var(--color-border)] px-4 py-3">
        {header}
        <h1 className="min-w-0 flex-1 truncate text-lg font-bold">{thread?.with.name ?? "…"}</h1>
      </div>
      <div className="flex-1 space-y-2 overflow-y-auto px-4 py-4" aria-live="polite">
        {thread === null && !problem ? (
          <Loader2 aria-hidden="true" className="mx-auto size-5 animate-spin text-[var(--color-muted-foreground)]" />
        ) : null}
        {thread?.messages.map((message) => {
          const mine = message.sender === side;
          return (
            <div key={message.id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
              <div
                className={`max-w-[80%] rounded-2xl px-3.5 py-2 text-sm leading-relaxed ${
                  mine
                    ? "rounded-br-md bg-[var(--color-brand)] text-white"
                    : "rounded-bl-md bg-[var(--color-muted)] text-[var(--color-foreground)]"
                }`}
              >
                {message.product ? (
                  <Link
                    href={`/marketplace/${message.product.id}`}
                    className={`mb-1.5 flex items-center gap-2 rounded-xl p-1.5 text-xs font-semibold ${
                      mine ? "bg-white/15" : "bg-[var(--color-card)]"
                    }`}
                  >
                    {message.product.photo ? (
                      <Image
                        src={message.product.photo}
                        alt=""
                        width={36}
                        height={36}
                        className="size-9 rounded-lg object-cover"
                      />
                    ) : null}
                    {t("chatAbout", { name: message.product.name })}
                  </Link>
                ) : null}
                <p className="whitespace-pre-line">{message.body}</p>
                <p className={`mt-0.5 text-[10px] ${mine ? "text-white/70" : "text-[var(--color-muted-foreground)]"}`}>
                  {new Date(message.created_at).toLocaleString("en-GH", {
                    day: "numeric",
                    month: "short",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </p>
              </div>
            </div>
          );
        })}
        <div ref={end} />
      </div>
      <form onSubmit={(event) => void submit(event)} className="flex items-end gap-2 border-t border-[var(--color-border)] p-3">
        <label htmlFor="chat-body" className="sr-only">
          {t("chatPlaceholder")}
        </label>
        <textarea
          id="chat-body"
          value={body}
          onChange={(event) => setBody(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              event.currentTarget.form?.requestSubmit();
            }
          }}
          placeholder={t("chatPlaceholder")}
          maxLength={1000}
          rows={1}
          className="max-h-32 min-h-11 flex-1 resize-none rounded-xl border border-[var(--color-border)] bg-[var(--color-muted)] px-3 py-2.5 text-sm outline-none focus:border-[var(--color-brand)]"
        />
        <button
          type="submit"
          disabled={busy || !body.trim()}
          aria-label={t("chatSend")}
          className="grid size-11 shrink-0 place-items-center rounded-full bg-[var(--color-brand)] text-white disabled:opacity-50"
        >
          {busy ? <Loader2 aria-hidden="true" className="size-4 animate-spin" /> : <Send aria-hidden="true" className="size-4" />}
        </button>
      </form>
      {problem ? (
        <p role="alert" className="px-4 pb-3 text-sm font-semibold text-[var(--color-destructive)]">
          {problem}
        </p>
      ) : null}
    </div>
  );
}
