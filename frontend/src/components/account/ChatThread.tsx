"use client";

import { Flag, GraduationCap, Loader2, Phone, Send, Store } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState } from "react";

import type { ChatReportReason, ChatThread as Thread } from "@/lib/account-api";

/** How often an open chat asks for new messages. */
const POLL_MS = 5000;

const REASONS = [
  { value: "scam", label: "reportScam" },
  { value: "money", label: "reportMoney" },
  { value: "abuse", label: "reportAbuse" },
  { value: "other", label: "reportOther" },
] as const satisfies ReadonlyArray<{ value: ChatReportReason; label: string }>;

/**
 * One chat, for the person (their account) or the business (a shop's or a
 * workshop's inbox): the same view with a different side and API. Asks for
 * new messages every few seconds while open and visible; nothing needs a
 * socket. Numbers are hidden until somebody taps "Share my number", which
 * shares only their own.
 */
export function ChatThread({
  side,
  load,
  send,
  share,
  report,
  header,
}: {
  side: "buyer" | "seller";
  load: () => Promise<Thread>;
  send: (body: string) => Promise<Thread>;
  share?: () => Promise<Thread>;
  report?: (reason: ChatReportReason, details: string) => Promise<{ detail: string }>;
  header?: React.ReactNode;
}) {
  const t = useTranslations("Chat");
  const [thread, setThread] = useState<Thread | null>(null);
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [reporting, setReporting] = useState(false);
  const [reported, setReported] = useState(false);
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
      setProblem(error instanceof Error ? error.message : t("failed"));
    }
    setBusy(false);
  }

  async function shareNumber() {
    if (!share || !thread) return;
    if (!window.confirm(t("shareConfirm", { name: thread.with.name }))) return;
    setBusy(true);
    setProblem(null);
    try {
      setThread(await share());
    } catch (error) {
      setProblem(error instanceof Error ? error.message : t("failed"));
    }
    setBusy(false);
  }

  const kindLabel = thread ? (thread.kind === "workshop" ? t("kindWorkshop") : t("kindShop")) : null;

  return (
    <div className="flex min-h-[60vh] flex-col rounded-2xl border border-[var(--color-border)] bg-[var(--color-card)]">
      <div className="flex items-center gap-3 border-b border-[var(--color-border)] px-4 py-3">
        {header}
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-lg font-bold">{thread?.with.name ?? "…"}</h1>
          {thread ? (
            <p className="flex items-center gap-1.5 text-xs text-[var(--color-muted-foreground)]">
              {thread.kind === "workshop" ? (
                <GraduationCap aria-hidden="true" className="size-3.5" />
              ) : (
                <Store aria-hidden="true" className="size-3.5" />
              )}
              {side === "buyer" ? (
                <Link href={thread.business.path} className="hover:underline">
                  {kindLabel} · {t("viewPage")}
                </Link>
              ) : (
                <span>
                  {kindLabel} · {thread.business.name}
                </span>
              )}
            </p>
          ) : null}
        </div>
        {report && thread ? (
          <button
            type="button"
            onClick={() => setReporting((open) => !open)}
            className="inline-flex min-h-10 items-center gap-1.5 rounded-full px-3 text-xs font-semibold text-[var(--color-muted-foreground)] hover:bg-[var(--color-muted)]"
          >
            <Flag aria-hidden="true" className="size-3.5" />
            {t("report")}
          </button>
        ) : null}
      </div>

      {reporting && report ? (
        <ReportForm
          onCancel={() => setReporting(false)}
          onSend={async (reason, details) => {
            await report(reason, details);
            setReporting(false);
            setReported(true);
          }}
        />
      ) : null}
      {reported ? (
        <p role="status" className="border-b border-[var(--color-border)] px-4 py-2 text-sm font-semibold text-[var(--color-visit)]">
          {t("reportSent")}
        </p>
      ) : null}

      <div className="flex-1 space-y-2 overflow-y-auto px-4 py-4" aria-live="polite">
        {thread === null && !problem ? (
          <Loader2 aria-hidden="true" className="mx-auto size-5 animate-spin text-[var(--color-muted-foreground)]" />
        ) : null}
        {thread?.messages.map((message) => {
          const mine = message.sender === side;
          const tint = mine ? "bg-white/15" : "bg-[var(--color-card)]";
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
                    className={`mb-1.5 flex items-center gap-2 rounded-xl p-1.5 text-xs font-semibold ${tint}`}
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
                    {t("about", { name: message.product.name })}
                  </Link>
                ) : null}
                {message.course ? (
                  <div className={`mb-1.5 rounded-xl p-2 text-xs ${tint}`}>
                    <p className="font-semibold">{t("enquiry", { title: message.course.title })}</p>
                    <p className={mine ? "text-white/80" : "text-[var(--color-muted-foreground)]"}>
                      {message.course.starts
                        ? `${t("enquiryStarts", {
                            date: new Date(message.course.starts).toLocaleDateString("en-GH", {
                              day: "numeric",
                              month: "short",
                            }),
                          })} · `
                        : ""}
                      {t("enquiryReference", { reference: message.course.reference })}
                    </p>
                  </div>
                ) : null}
                {message.kind === "phone" ? (
                  <p>
                    <span className="block text-xs font-semibold">
                      {mine ? t("phoneYours") : t("phoneShared")}
                    </span>
                    <a
                      href={`tel:${message.body}`}
                      className="mt-1 inline-flex items-center gap-1.5 font-bold underline underline-offset-2"
                    >
                      <Phone aria-hidden="true" className="size-3.5" />
                      {mine ? message.body : t("call", { phone: message.body })}
                    </a>
                  </p>
                ) : (
                  <p className="whitespace-pre-line">{message.body}</p>
                )}
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

      {share && thread ? (
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--color-border)] px-4 py-2">
          <p className="text-xs text-[var(--color-muted-foreground)]">{t("privacy")}</p>
          <button
            type="button"
            onClick={() => void shareNumber()}
            disabled={busy}
            className="inline-flex min-h-9 items-center gap-1.5 rounded-full border border-[var(--color-border)] px-3 text-xs font-semibold hover:border-[var(--color-brand)] disabled:opacity-50"
          >
            <Phone aria-hidden="true" className="size-3.5" />
            {t("shareNumber")}
          </button>
        </div>
      ) : null}

      <form onSubmit={(event) => void submit(event)} className="flex items-end gap-2 border-t border-[var(--color-border)] p-3">
        <label htmlFor="chat-body" className="sr-only">
          {t("placeholder")}
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
          placeholder={t("placeholder")}
          maxLength={1000}
          rows={1}
          className="max-h-32 min-h-11 flex-1 resize-none rounded-xl border border-[var(--color-border)] bg-[var(--color-muted)] px-3 py-2.5 text-sm outline-none focus:border-[var(--color-brand)]"
        />
        <button
          type="submit"
          disabled={busy || !body.trim()}
          aria-label={t("send")}
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

/** Why this chat is being reported, and anything else staff should know. */
function ReportForm({
  onCancel,
  onSend,
}: {
  onCancel: () => void;
  onSend: (reason: ChatReportReason, details: string) => Promise<void>;
}) {
  const t = useTranslations("Chat");
  const [reason, setReason] = useState<ChatReportReason | null>(null);
  const [details, setDetails] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        if (!reason) return;
        setBusy(true);
        setProblem(null);
        onSend(reason, details.trim())
          .catch((error: Error) => setProblem(error.message))
          .finally(() => setBusy(false));
      }}
      className="space-y-3 border-b border-[var(--color-border)] bg-[var(--color-muted)] px-4 py-3"
    >
      <p className="text-sm font-bold">{t("reportTitle")}</p>
      <p className="text-xs text-[var(--color-muted-foreground)]">{t("reportLead")}</p>
      <fieldset className="space-y-1.5">
        <legend className="text-xs font-semibold">{t("reportReason")}</legend>
        {REASONS.map((option) => (
          <label key={option.value} className="flex min-h-9 items-center gap-2 text-sm">
            <input
              type="radio"
              name="chat-report-reason"
              value={option.value}
              checked={reason === option.value}
              onChange={() => setReason(option.value)}
            />
            {t(option.label)}
          </label>
        ))}
      </fieldset>
      <label className="block text-xs font-semibold">
        {t("reportDetails")}
        <textarea
          value={details}
          onChange={(event) => setDetails(event.target.value)}
          maxLength={1000}
          rows={2}
          className="mt-1 block w-full rounded-xl border border-[var(--color-border)] bg-[var(--color-card)] px-3 py-2 text-sm font-normal"
        />
      </label>
      {problem ? (
        <p role="alert" className="text-sm font-semibold text-[var(--color-destructive)]">
          {problem}
        </p>
      ) : null}
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={!reason || busy}
          className="min-h-10 rounded-full bg-[var(--color-brand)] px-4 text-sm font-semibold text-white disabled:opacity-50"
        >
          {t("reportSend")}
        </button>
        <button type="button" onClick={onCancel} className="min-h-10 rounded-full px-4 text-sm font-semibold">
          {t("reportCancel")}
        </button>
      </div>
    </form>
  );
}
