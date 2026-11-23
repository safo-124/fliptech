"use client";

import { Flag, Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";

import { reportVideo, type VideoReportReason } from "@/lib/course-api";
import { TrainerApiError } from "@/lib/trainer-fetch";

const REASONS: VideoReportReason[] = [
  "not_theirs",
  "no_consent",
  "child",
  "unsafe",
  "offensive",
  "advertising",
  "other",
];

/**
 * "Report this video" under a lesson. Videos go live before staff have
 * watched them, so the people watching are the other pair of eyes: a report
 * puts the video in front of staff (backend/providers/video_reports.py).
 * Signed in only, so each person counts once. Keyed by lesson where it is
 * used, so a new lesson starts closed.
 */
export function ReportVideo({
  videoId,
  signedIn,
  signInHref,
}: {
  videoId: number;
  signedIn: boolean;
  signInHref: string;
}) {
  const t = useTranslations("VideoReport");
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<VideoReportReason | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  const linkClass =
    "inline-flex min-h-10 items-center gap-1.5 text-xs font-semibold text-[var(--color-muted-foreground)] hover:text-[var(--color-destructive)] hover:underline";

  if (sent) {
    return (
      <p role="status" className="text-sm font-semibold text-[var(--color-visit)]">
        {t("thanks")}
      </p>
    );
  }

  if (!signedIn) {
    return (
      <a href={signInHref} className={linkClass}>
        <Flag aria-hidden="true" className="size-3.5" />
        {t("signIn")}
      </a>
    );
  }

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className={linkClass}>
        <Flag aria-hidden="true" className="size-3.5" />
        {t("open")}
      </button>
    );
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!reason) {
      setProblem(t("reasonRequired"));
      return;
    }
    setBusy(true);
    setProblem(null);
    try {
      await reportVideo(videoId, reason, note.trim());
      setSent(true);
    } catch (error) {
      setProblem(error instanceof TrainerApiError ? error.message : t("failed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      onSubmit={submit}
      noValidate
      className="space-y-3 rounded-2xl border border-[var(--color-border)] bg-[var(--color-card)] p-4"
    >
      <fieldset className="space-y-1">
        <legend className="mb-2 text-sm font-semibold">{t("title")}</legend>
        {REASONS.map((value) => (
          <label key={value} className="flex min-h-10 items-center gap-2.5 text-sm">
            <input
              type="radio"
              name={`report-${videoId}`}
              value={value}
              checked={reason === value}
              onChange={() => {
                setReason(value);
                setProblem(null);
              }}
              className="size-4 shrink-0 accent-[var(--color-brand)]"
            />
            {t(`reasons.${value}`)}
          </label>
        ))}
      </fieldset>
      <div className="space-y-1.5">
        <label htmlFor={`report-note-${videoId}`} className="text-sm font-semibold">
          {t("noteLabel")}
        </label>
        <textarea
          id={`report-note-${videoId}`}
          value={note}
          onChange={(event) => setNote(event.target.value)}
          rows={2}
          maxLength={500}
          className="w-full resize-none rounded-xl border border-[var(--color-border)] bg-transparent p-2 text-sm outline-none focus:border-[var(--color-brand)]/50"
        />
      </div>
      {problem ? (
        <p role="alert" className="text-sm text-[var(--color-destructive)]">
          {problem}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <button
          type="submit"
          disabled={busy}
          className="inline-flex min-h-10 items-center gap-2 rounded-full bg-[var(--color-destructive)] px-4 text-sm font-bold text-white transition hover:opacity-90 disabled:opacity-50"
        >
          {busy ? <Loader2 aria-hidden="true" className="size-4 animate-spin" /> : <Flag aria-hidden="true" className="size-4" />}
          {t("send")}
        </button>
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            setProblem(null);
          }}
          className="inline-flex min-h-10 items-center rounded-full px-4 text-sm font-semibold text-[var(--color-muted-foreground)] hover:bg-[var(--color-muted)]"
        >
          {t("cancel")}
        </button>
      </div>
    </form>
  );
}
