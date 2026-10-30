"use client";

import { ChevronLeft, ChevronRight, Loader2, Lock, PlayCircle } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { VideoLesson } from "@/components/VideoLesson";
import { buyCourse, getCourseAccess, verifyPurchase } from "@/lib/course-api";
import type { CourseAccess, ProviderVideo } from "@/lib/types";

export type CourseLesson = {
  video: ProviderVideo;
  /** "Play the video: …", for the play button. */
  playLabel: string;
  /** "12 minutes · about 40 MB to watch", or the generic line for YouTube. */
  meta: string;
};

type Labels = {
  contents: string;
  /** "2 lessons · 3 min", under the contents heading. */
  summary: string;
  quality: string;
  previous: string;
  next: string;
  /** "Lesson 1 of 2", one per lesson. */
  lessonNumber: string[];
  /** For a paid course; absent for a free one. */
  locked?: {
    title: string;
    /** "Buy the whole course for GH₵150 to watch this lesson…" */
    body: string;
    buy: string;
    buying: string;
    signIn: string;
    checking: string;
    unavailable: string;
    failed: string;
    preview: string;
  };
};

/**
 * One lesson at a time, with the course listed beside it.
 *
 * Choosing a lesson shows its still, not a playing video: the trainee taps
 * play, as everywhere else on the site, because that tap is what spends
 * their data. Words arrive as props, worked out on the server, so this
 * component carries no message catalogue.
 *
 * A paid course arrives with its locked lessons' files left out, because the
 * page is cached and the same for everybody. This asks the API what this
 * browser may watch and fills them in: everything for a buyer, the free
 * first lesson for anyone else, who gets a way to buy in place of the rest.
 * Coming back from Paystack, it asks the server to confirm the payment
 * (backend courses/views.py) before unlocking anything.
 */
export function CoursePlayer({
  lessons,
  labels,
  course,
}: {
  lessons: CourseLesson[];
  labels: Labels;
  /** Where the course lives, for its access, buy and sign-in addresses. */
  course: { area: string; slug: string; paid: boolean };
}) {
  const [index, setIndex] = useState(0);
  const [access, setAccess] = useState<CourseAccess | null>(null);
  const [busy, setBusy] = useState<"buying" | "checking" | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!course.paid) return;
    try {
      setAccess(await getCourseAccess(course.area, course.slug));
    } catch {
      // The free lesson still plays; the rest stay locked.
    }
  }, [course.area, course.paid, course.slug]);

  useEffect(() => {
    let active = true;
    async function load() {
      const url = new URL(window.location.href);
      const reference = url.searchParams.get("purchase");
      if (reference && course.paid) {
        // Back from Paystack. Forget the reference in the address bar, so a
        // reload or a shared link does not ask again.
        // Paystack adds its own copies of the reference; they go too.
        for (const name of ["purchase", "reference", "trxref"]) url.searchParams.delete(name);
        window.history.replaceState(null, "", url.toString());
        if (active) setBusy("checking");
        try {
          const result = await verifyPurchase(reference);
          if (active && !result.owned) setProblem(labels.locked?.failed ?? null);
        } catch (reason) {
          if (active) setProblem(reason instanceof Error ? reason.message : null);
        } finally {
          if (active) setBusy(null);
        }
      }
      if (active) await refresh();
    }
    void load();
    return () => {
      active = false;
    };
  }, [course.paid, labels.locked?.failed, refresh]);

  async function buy() {
    setBusy("buying");
    setProblem(null);
    try {
      const { authorization_url } = await buyCourse(course.area, course.slug);
      window.location.href = authorization_url;
    } catch (reason) {
      setProblem(reason instanceof Error ? reason.message : labels.locked?.unavailable ?? null);
      setBusy(null);
      // "You already have this course": show it unlocked.
      await refresh();
    }
  }

  const playable = lessons.map((lesson) => {
    const sources = access?.sources[String(lesson.video.id)];
    if (!lesson.video.locked || !sources) return lesson;
    return { ...lesson, video: { ...lesson.video, locked: false, sources } };
  });

  const current = playable[index];
  if (!current) return null;
  const previous = playable[index - 1];
  const next = playable[index + 1];
  const progress = Math.round(((index + 1) / playable.length) * 100);
  const signInHref = `/trainee/sign-in?next=${encodeURIComponent(`/learn/${course.area}/${course.slug}`)}`;

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem] lg:gap-8">
      <div id="player" className="min-w-0 scroll-mt-24">
        <div className="overflow-hidden rounded-2xl bg-black shadow-[var(--shadow-lg)] ring-1 ring-black/5">
          {current.video.locked && labels.locked ? (
            <LockedLesson
              poster={current.video.poster}
              labels={labels.locked}
              busy={busy}
              problem={problem}
              signedIn={access?.signed_in ?? false}
              paymentsEnabled={access?.payments_enabled ?? true}
              signInHref={signInHref}
              onBuy={buy}
            />
          ) : (
            // Keyed by lesson, so moving on starts the next one from its
            // still rather than carrying the last one's player across.
            <VideoLesson
              key={`${current.video.id}-${current.video.sources.length}`}
              video={current.video}
              playLabel={current.playLabel}
              qualityLabel={labels.quality}
            />
          )}
        </div>

        <div className="mt-4 flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-xs font-bold uppercase tracking-[0.1em] text-[var(--color-brand)]">
              {labels.lessonNumber[index]}
              {index === 0 && course.paid && labels.locked ? ` · ${labels.locked.preview}` : null}
            </p>
            <h2 className="mt-1 text-xl font-extrabold tracking-[-0.02em] text-[var(--color-brand-deep)] sm:text-2xl">
              {current.video.title}
            </h2>
            <p className="mt-1 text-sm text-[var(--color-muted-foreground)]">{current.meta}</p>
          </div>
          <div className="flex gap-2">
            {previous ? (
              <button
                type="button"
                onClick={() => setIndex(index - 1)}
                className="inline-flex min-h-11 items-center gap-1 rounded-full border border-[var(--color-border-strong)] bg-[var(--color-card)] px-4 text-sm font-semibold hover:bg-[var(--color-muted)]"
              >
                <ChevronLeft aria-hidden="true" className="size-4" />
                {labels.previous}
              </button>
            ) : null}
            {next ? (
              <button
                type="button"
                onClick={() => setIndex(index + 1)}
                className="inline-flex min-h-11 items-center gap-1 rounded-full bg-[var(--color-brand)] px-4 text-sm font-semibold text-white hover:bg-[var(--color-brand-strong)]"
              >
                {labels.next}
                <ChevronRight aria-hidden="true" className="size-4" />
              </button>
            ) : null}
          </div>
        </div>
      </div>

      <nav
        aria-label={labels.contents}
        className="h-fit rounded-2xl border border-[var(--color-border)] bg-[var(--color-card)] p-4 shadow-[var(--shadow-card)] lg:sticky lg:top-24"
      >
        <h2 className="font-bold">{labels.contents}</h2>
        <p className="mt-0.5 text-xs text-[var(--color-muted-foreground)]">{labels.summary}</p>
        {/* How far through the course the chosen lesson is. */}
        <div
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={progress}
          aria-label={labels.lessonNumber[index]}
          className="mt-3 h-1.5 overflow-hidden rounded-full bg-[var(--color-muted)]"
        >
          <div className="h-full rounded-full bg-[var(--color-brand)]" style={{ width: `${progress}%` }} />
        </div>
        <ol className="mt-4 max-h-[60vh] space-y-1.5 overflow-y-auto">
          {playable.map((lesson, position) => (
            <li key={lesson.video.id}>
              <button
                type="button"
                onClick={() => setIndex(position)}
                aria-current={position === index ? "true" : undefined}
                className="flex w-full items-start gap-3 rounded-xl p-2.5 text-left transition-colors hover:bg-[var(--color-muted)] aria-[current=true]:bg-[var(--color-brand-soft)]"
              >
                <span
                  className={`mt-0.5 grid size-7 shrink-0 place-items-center rounded-full text-xs font-bold ${
                    position === index
                      ? "bg-[var(--color-brand)] text-white"
                      : "bg-[var(--color-muted)] text-[var(--color-foreground)]/70"
                  }`}
                >
                  {lesson.video.locked ? (
                    <Lock aria-hidden="true" className="size-3.5" />
                  ) : position === index ? (
                    <PlayCircle aria-hidden="true" className="size-4" />
                  ) : (
                    position + 1
                  )}
                </span>
                <span className="min-w-0">
                  <span className="block break-words text-sm font-semibold leading-5">
                    {lesson.video.title}
                  </span>
                  <span className="mt-0.5 block text-xs text-[var(--color-muted-foreground)]">
                    {lesson.meta}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ol>
      </nav>
    </div>
  );
}

/** Where a locked lesson's player would be: its still, and the way to buy. */
function LockedLesson({
  poster,
  labels,
  busy,
  problem,
  signedIn,
  paymentsEnabled,
  signInHref,
  onBuy,
}: {
  poster: string | null;
  labels: NonNullable<Labels["locked"]>;
  busy: "buying" | "checking" | null;
  problem: string | null;
  signedIn: boolean;
  paymentsEnabled: boolean;
  signInHref: string;
  onBuy: () => void;
}) {
  const action =
    "inline-flex min-h-11 items-center gap-2 rounded-full bg-[var(--color-brand)] px-5 text-sm font-bold text-white hover:bg-[var(--color-brand-strong)] disabled:opacity-70";
  return (
    <div className="relative grid aspect-video place-items-center overflow-hidden text-center text-white">
      {poster ? (
        // The still behind a dark veil: what they would be buying, not playable.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={poster} alt="" className="absolute inset-0 size-full object-cover opacity-35 blur-[2px]" />
      ) : null}
      <div className="relative max-w-sm px-6 py-4">
        <span className="mx-auto grid size-12 place-items-center rounded-full bg-white/15 ring-1 ring-white/30">
          <Lock aria-hidden="true" className="size-5" />
        </span>
        <p className="mt-3 text-lg font-extrabold">{labels.title}</p>
        <p className="mt-1 text-sm leading-relaxed text-white/80">{labels.body}</p>
        <div className="mt-4">
          {busy === "checking" ? (
            <p className="inline-flex items-center gap-2 text-sm font-semibold">
              <Loader2 aria-hidden="true" className="size-4 animate-spin" />
              {labels.checking}
            </p>
          ) : !paymentsEnabled ? (
            <p className="text-sm text-white/80">{labels.unavailable}</p>
          ) : signedIn ? (
            <button type="button" onClick={onBuy} disabled={busy !== null} className={action}>
              {busy === "buying" ? <Loader2 aria-hidden="true" className="size-4 animate-spin" /> : null}
              {busy === "buying" ? labels.buying : labels.buy}
            </button>
          ) : (
            <a href={signInHref} className={action}>
              {labels.signIn}
            </a>
          )}
        </div>
        {problem ? (
          <p role="alert" className="mt-3 text-sm font-semibold text-[var(--color-peach)]">
            {problem}
          </p>
        ) : null}
      </div>
    </div>
  );
}
