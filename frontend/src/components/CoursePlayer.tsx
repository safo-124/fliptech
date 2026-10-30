"use client";

import { ChevronRight, PlayCircle } from "lucide-react";
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
  labels: { lessons: string; quality: string; next: string; lessonNumber: string[] };
}) {
  const [index, setIndex] = useState(0);
  const current = lessons[index];
  if (!current) return null;
  const next = lessons[index + 1];

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
      <div>
        {/* Keyed by lesson, so moving on starts the next one from its still
            rather than carrying the last one's player across. */}
        <VideoLesson
          key={current.video.id}
          video={current.video}
          playLabel={current.playLabel}
          qualityLabel={labels.quality}
        />
        <p className="mt-3 text-xs font-bold uppercase tracking-[0.08em] text-[var(--color-muted-foreground)]">
          {labels.lessonNumber[index]}
        </p>
        <h2 className="mt-1 text-xl font-bold tracking-[-0.02em]">{current.video.title}</h2>
        <p className="mt-1 text-sm text-[var(--color-muted-foreground)]">{current.meta}</p>
        {next ? (
          <button
            type="button"
            onClick={() => setIndex(index + 1)}
            className="mt-4 inline-flex items-center gap-1.5 rounded-full bg-[var(--color-brand)] px-4 py-2 text-sm font-semibold text-white hover:opacity-90"
          >
            {labels.next}
            <ChevronRight aria-hidden="true" className="size-4" />
          </button>
        ) : null}
      </div>

      <nav aria-label={labels.lessons}>
        <h2 className="text-sm font-bold">{labels.lessons}</h2>
        <ol className="mt-3 space-y-1.5">
          {lessons.map((lesson, position) => (
            <li key={lesson.video.id}>
              <button
                type="button"
                onClick={() => setIndex(position)}
                aria-current={position === index ? "true" : undefined}
                className="flex w-full items-start gap-3 rounded-xl border border-[var(--color-border)] p-3 text-left transition-colors hover:bg-[var(--color-muted)] aria-[current=true]:border-[var(--color-brand)] aria-[current=true]:bg-[var(--color-brand-soft)]"
              >
                <span className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-full bg-[var(--color-muted)] text-xs font-bold">
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
