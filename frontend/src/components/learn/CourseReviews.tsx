"use client";

import { Loader2, MessageSquareQuote } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState, type FormEvent } from "react";

import { getCourseReviews, sendCourseReview } from "@/lib/course-api";
import { TrainerApiError } from "@/lib/trainer-fetch";
import type { CourseReview, RatingSummary } from "@/lib/types";

import { StarPicker, Stars } from "./Stars";

/** The course's stars and words, and writing yours once you have watched. */
export function CourseReviews({
  area,
  slug,
  initial,
  mine,
  canReview,
  signedIn,
  signInHref,
}: {
  area: string;
  slug: string;
  initial: RatingSummary;
  mine: CourseReview | null;
  canReview: boolean;
  signedIn: boolean;
  signInHref: string;
}) {
  const t = useTranslations("Classroom");
  const [summary, setSummary] = useState(initial);
  const [reviews, setReviews] = useState<CourseReview[] | null>(null);
  const [rating, setRating] = useState(mine?.rating ?? 0);
  const [body, setBody] = useState(mine?.body ?? "");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [thanks, setThanks] = useState(false);
  const names = [t("star1"), t("star2"), t("star3"), t("star4"), t("star5")];

  useEffect(() => {
    getCourseReviews(area, slug)
      .then((reply) => {
        setSummary(reply.summary);
        setReviews(reply.results);
      })
      .catch(() => setReviews([]));
  }, [area, slug]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!rating) return;
    setBusy(true);
    setProblem(null);
    try {
      const reply = await sendCourseReview(area, slug, rating, body);
      setSummary(reply.summary);
      setReviews((list) => [reply.review, ...(list ?? []).filter((r) => r.id !== reply.review.id)]);
      setThanks(true);
    } catch (error) {
      setProblem(error instanceof TrainerApiError ? error.message : t("tryAgain"));
    } finally {
      setBusy(false);
    }
  }

  const total = summary.count || 1;

  return (
    <div className="space-y-6">
      <div className="grid gap-5 rounded-2xl border border-[var(--color-border)] bg-[var(--color-card)] p-5 sm:grid-cols-[auto_1fr] sm:items-center">
        <div className="text-center sm:pr-6 sm:text-left">
          <p className="text-5xl font-extrabold tracking-tight text-[var(--color-brand-deep)]">
            {summary.average ? summary.average.toFixed(1) : "–"}
          </p>
          <Stars value={summary.average ?? 0} label={t("ratingLabel", { rating: summary.average ?? 0 })} />
          <p className="mt-1 text-xs text-[var(--color-muted-foreground)]">
            {t("reviewCount", { count: summary.count })}
          </p>
        </div>
        <ul className="space-y-1.5">
          {["5", "4", "3", "2", "1"].map((stars) => {
            const n = summary.spread[stars] ?? 0;
            return (
              <li key={stars} className="flex items-center gap-2 text-xs">
                <span className="w-3 font-bold tabular-nums">{stars}</span>
                <span className="h-2 flex-1 overflow-hidden rounded-full bg-[var(--color-muted)]">
                  <span
                    className="block h-full rounded-full bg-[var(--color-warn)] transition-[width] duration-700"
                    style={{ width: `${(n / total) * 100}%` }}
                  />
                </span>
                <span className="w-6 text-right tabular-nums text-[var(--color-muted-foreground)]">{n}</span>
              </li>
            );
          })}
        </ul>
      </div>

      {canReview ? (
        <form onSubmit={submit} className="rounded-2xl border border-[var(--color-brand)]/20 bg-[var(--color-brand-soft)]/50 p-4">
          <p className="font-bold">{mine ? t("editReview") : t("writeReview")}</p>
          <div className="mt-2">
            <StarPicker value={rating} onChange={setRating} label={t("yourRating")} names={names} />
          </div>
          <label htmlFor="review-body" className="sr-only">
            {t("reviewBody")}
          </label>
          <textarea
            id="review-body"
            value={body}
            onChange={(event) => setBody(event.target.value)}
            rows={3}
            maxLength={1000}
            placeholder={t("reviewPlaceholder")}
            className="mt-3 w-full rounded-xl border border-[var(--color-border)] bg-[var(--color-card)] p-3 text-sm outline-none focus:border-[var(--color-brand)]/50"
          />
          <div className="mt-3 flex items-center gap-3">
            <button
              type="submit"
              disabled={busy || !rating}
              className="inline-flex min-h-10 items-center gap-2 rounded-full bg-[var(--color-brand)] px-5 text-sm font-bold text-white hover:bg-[var(--color-brand-strong)] disabled:opacity-50"
            >
              {busy ? <Loader2 aria-hidden="true" className="size-4 animate-spin" /> : null}
              {t("postReview")}
            </button>
            {thanks ? (
              <span role="status" className="text-sm font-semibold text-[var(--color-visit)]">
                {t("reviewThanks")}
              </span>
            ) : null}
          </div>
          {problem ? (
            <p role="alert" className="mt-2 text-sm text-[var(--color-destructive)]">
              {problem}
            </p>
          ) : null}
        </form>
      ) : signedIn ? (
        <p className="text-sm text-[var(--color-muted-foreground)]">{t("reviewAfterLesson")}</p>
      ) : (
        <a href={signInHref} className="text-sm font-semibold text-[var(--color-brand)] hover:underline">
          {t("signInToReview")}
        </a>
      )}

      {reviews === null ? (
        <div className="h-24 animate-pulse rounded-2xl bg-[var(--color-muted)]" aria-busy="true" />
      ) : reviews.length === 0 ? (
        <div className="rounded-2xl bg-[var(--color-muted)]/60 p-6 text-center">
          <MessageSquareQuote aria-hidden="true" className="mx-auto size-8 text-[var(--color-muted-foreground)]" />
          <p className="mt-2 text-sm font-semibold">{t("noReviews")}</p>
        </div>
      ) : (
        <ul className="space-y-3">
          {reviews.map((review) => (
            <li key={review.id} className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-card)] p-4">
              <div className="flex items-center justify-between gap-3">
                <span className="flex items-center gap-2">
                  <span
                    aria-hidden="true"
                    className="grid size-8 place-items-center rounded-full bg-[var(--color-brand-soft)] text-xs font-extrabold text-[var(--color-brand)]"
                  >
                    {review.name.slice(0, 1).toUpperCase()}
                  </span>
                  <span className="text-sm font-bold">{review.name}</span>
                </span>
                <Stars value={review.rating} size="size-3.5" />
              </div>
              {review.body ? (
                <p className="mt-2 whitespace-pre-line break-words text-sm leading-relaxed">{review.body}</p>
              ) : null}
              {review.reply ? (
                <div className="mt-3 rounded-xl bg-[var(--color-muted)] p-3">
                  <p className="text-xs font-bold text-[var(--color-brand)]">{t("trainerReply")}</p>
                  <p className="mt-1 whitespace-pre-line text-sm">{review.reply}</p>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
