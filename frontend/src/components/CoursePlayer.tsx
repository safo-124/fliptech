"use client";

import { ChevronLeft, ChevronRight, PlayCircle } from "lucide-react";
import { useState } from "react";

import { VideoLesson } from "@/components/VideoLesson";
import type { ProviderVideo } from "@/lib/types";

export type CourseLesson = {
  video: ProviderVideo;
  /** "Play the video: …", for the play button. */
  playLabel: string;
  /** "12 minutes · about 40 MB to watch", or the generic line for YouTube. */
  meta: string;
};

/**
 * One lesson at a time, with the course listed beside it.
 *
 * Choosing a lesson shows its still, not a playing video: the trainee taps
 * play, as everywhere else on the site, because that tap is what spends
 * their data. Words arrive as props, worked out on the server, so this
 * component carries no message catalogue.
 */
export function CoursePlayer({
  lessons,
  labels,
}: {
  lessons: CourseLesson[];
  labels: {
    contents: string;
    /** "2 lessons · 3 min", under the contents heading. */
    summary: string;
    quality: string;
    previous: string;
    next: string;
    /** "Lesson 1 of 2", one per lesson. */
    lessonNumber: string[];
  };
}) {
  const [index, setIndex] = useState(0);
  const current = lessons[index];
  if (!current) return null;
  const previous = lessons[index - 1];
  const next = lessons[index + 1];
  const progress = Math.round(((index + 1) / lessons.length) * 100);

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem] lg:gap-8">
      <div id="player" className="min-w-0 scroll-mt-24">
        <div className="overflow-hidden rounded-2xl bg-black shadow-[var(--shadow-lg)] ring-1 ring-black/5">
          {/* Keyed by lesson, so moving on starts the next one from its
              still rather than carrying the last one's player across. */}
          <VideoLesson
            key={current.video.id}
            video={current.video}
            playLabel={current.playLabel}
            qualityLabel={labels.quality}
          />
        </div>

        <div className="mt-4 flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-xs font-bold uppercase tracking-[0.1em] text-[var(--color-brand)]">
              {labels.lessonNumber[index]}
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
          {lessons.map((lesson, position) => (
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
                  {position === index ? <PlayCircle aria-hidden="true" className="size-4" /> : position + 1}
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
