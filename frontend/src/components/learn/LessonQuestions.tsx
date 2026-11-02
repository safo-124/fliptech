"use client";

import { Clock3, Loader2, MessageCircleQuestion, Send } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState, type FormEvent } from "react";

import { askLessonQuestion, getLessonQuestions } from "@/lib/course-api";
import { TrainerApiError } from "@/lib/trainer-fetch";
import type { LessonQuestion } from "@/lib/types";

import { clock } from "./LessonPlayer";

/** Questions under one lesson, and asking one, with the time it was at. */
export function LessonQuestions({
  videoId,
  locked,
  signedIn,
  signInHref,
  currentTime,
  onSeek,
  onCount,
}: {
  videoId: number;
  locked: boolean;
  signedIn: boolean;
  signInHref: string;
  /** Where the player is, to attach to the question. */
  currentTime: number;
  onSeek: (seconds: number) => void;
  onCount?: (count: number) => void;
}) {
  const t = useTranslations("Classroom");
  const [questions, setQuestions] = useState<LessonQuestion[] | null>(null);
  const [mine, setMine] = useState<number[]>([]);
  const [body, setBody] = useState("");
  const [attach, setAttach] = useState(true);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  // Keyed by lesson where it is used, so a new lesson starts afresh.
  useEffect(() => {
    let active = true;
    getLessonQuestions(videoId)
      .then((reply) => {
        if (!active) return;
        setQuestions(reply.results);
        setMine(reply.mine);
        onCount?.(reply.results.length);
      })
      .catch(() => {
        if (active) setQuestions([]);
      });
    return () => {
      active = false;
    };
  }, [videoId, onCount]);

  async function ask(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setProblem(null);
    try {
      const made = await askLessonQuestion(videoId, body, attach && currentTime > 1 ? currentTime : undefined);
      setQuestions((list) => [made, ...(list ?? [])]);
      setMine((ids) => [made.id, ...ids]);
      setBody("");
      setSent(true);
    } catch (error) {
      setProblem(error instanceof TrainerApiError ? error.message : t("tryAgain"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      {locked ? (
        <p className="rounded-xl bg-[var(--color-muted)] p-4 text-sm text-[var(--color-muted-foreground)]">
          {t("askLocked")}
        </p>
      ) : signedIn ? (
        <form onSubmit={ask} className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-card)] p-3 shadow-[var(--shadow-card)] focus-within:border-[var(--color-brand)]/40">
          <label htmlFor={`ask-${videoId}`} className="sr-only">
            {t("askLabel")}
          </label>
          <textarea
            id={`ask-${videoId}`}
            value={body}
            onChange={(event) => setBody(event.target.value)}
            rows={2}
            maxLength={800}
            placeholder={t("askPlaceholder")}
            className="w-full resize-none bg-transparent p-1 text-sm outline-none placeholder:text-[var(--color-muted-foreground)]"
          />
          <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
            {currentTime > 1 ? (
              <button
                type="button"
                onClick={() => setAttach((on) => !on)}
                aria-pressed={attach}
                className="inline-flex items-center gap-1.5 rounded-full border border-[var(--color-border)] px-3 py-1 text-xs font-semibold text-[var(--color-muted-foreground)] aria-pressed:border-[var(--color-brand)]/30 aria-pressed:bg-[var(--color-brand-soft)] aria-pressed:text-[var(--color-brand)]"
              >
                <Clock3 aria-hidden="true" className="size-3.5" />
                {t("atTime", { time: clock(currentTime) })}
              </button>
            ) : (
              <span />
            )}
            <button
              type="submit"
              disabled={busy || body.trim().length < 5}
              className="inline-flex min-h-10 items-center gap-2 rounded-full bg-[var(--color-brand)] px-4 text-sm font-bold text-white transition hover:bg-[var(--color-brand-strong)] disabled:opacity-50"
            >
              {busy ? <Loader2 aria-hidden="true" className="size-4 animate-spin" /> : <Send aria-hidden="true" className="size-4" />}
              {t("ask")}
            </button>
          </div>
          {problem ? (
            <p role="alert" className="mt-2 text-sm text-[var(--color-destructive)]">
              {problem}
            </p>
          ) : null}
          {sent ? (
            <p role="status" className="mt-2 text-sm font-semibold text-[var(--color-visit)]">
              {t("asked")}
            </p>
          ) : null}
        </form>
      ) : (
        <a
          href={signInHref}
          className="flex items-center gap-3 rounded-2xl border border-dashed border-[var(--color-border-strong)] p-4 text-sm font-semibold text-[var(--color-brand)] hover:bg-[var(--color-brand-soft)]"
        >
          <MessageCircleQuestion aria-hidden="true" className="size-5" />
          {t("signInToAsk")}
        </a>
      )}

      {questions === null ? (
        <div className="space-y-3" aria-busy="true">
          {[0, 1].map((n) => (
            <div key={n} className="h-20 animate-pulse rounded-2xl bg-[var(--color-muted)]" />
          ))}
        </div>
      ) : questions.length === 0 ? (
        <div className="rounded-2xl bg-[var(--color-muted)]/60 p-6 text-center">
          <MessageCircleQuestion aria-hidden="true" className="mx-auto size-8 text-[var(--color-muted-foreground)]" />
          <p className="mt-2 text-sm font-semibold">{t("noQuestions")}</p>
          <p className="mt-1 text-sm text-[var(--color-muted-foreground)]">{t("noQuestionsBody")}</p>
        </div>
      ) : (
        <ul className="space-y-3">
          {questions.map((question) => (
            <li
              key={question.id}
              className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-card)] p-4 animate-[rise-in_0.35s_ease-out]"
            >
              <div className="flex items-start gap-3">
                <span
                  aria-hidden="true"
                  className="grid size-9 shrink-0 place-items-center rounded-full bg-gradient-to-br from-[var(--color-sand)] to-[var(--color-peach)] text-sm font-extrabold text-[var(--color-brand-deep)]"
                >
                  {question.name.slice(0, 1).toUpperCase()}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-x-2 text-xs text-[var(--color-muted-foreground)]">
                    <span className="font-bold text-[var(--color-foreground)]">
                      {mine.includes(question.id) ? t("you") : question.name}
                    </span>
                    {question.at_seconds !== null ? (
                      <button
                        type="button"
                        onClick={() => onSeek(question.at_seconds ?? 0)}
                        className="inline-flex items-center gap-1 rounded-full bg-[var(--color-brand-soft)] px-2 py-0.5 font-bold text-[var(--color-brand)] hover:underline"
                      >
                        <Clock3 aria-hidden="true" className="size-3" />
                        {clock(question.at_seconds)}
                      </button>
                    ) : null}
                  </p>
                  <p className="mt-1 whitespace-pre-line break-words text-sm leading-relaxed">{question.body}</p>
                  {question.answer ? (
                    <div className="mt-3 rounded-xl border-l-4 border-[var(--color-brand)] bg-[var(--color-brand-soft)]/60 p-3">
                      <p className="text-xs font-bold uppercase tracking-wider text-[var(--color-brand)]">
                        {t("trainerAnswer")}
                      </p>
                      <p className="mt-1 whitespace-pre-line break-words text-sm leading-relaxed">{question.answer}</p>
                    </div>
                  ) : (
                    <p className="mt-2 text-xs font-semibold text-[var(--color-warn)]">{t("waitingForAnswer")}</p>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
