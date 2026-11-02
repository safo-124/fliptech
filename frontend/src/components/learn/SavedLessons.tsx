"use client";

import { HardDrive, Play, Trash2, WifiOff, X } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";

import { offlineUrl, removeLesson, useSavedLessons, type SavedLesson } from "@/lib/offline-lessons";

import { clock } from "./LessonPlayer";

/**
 * Lessons kept on this phone. Plays them from the phone itself, so this
 * works with no signal at all.
 */
export function SavedLessons() {
  const t = useTranslations("MyLearning");
  const lessons = useSavedLessons();
  const [playing, setPlaying] = useState<{ lesson: SavedLesson; url: string } | null>(null);
  const player = useRef<HTMLVideoElement>(null);

  useEffect(() => () => {
    if (playing) URL.revokeObjectURL(playing.url);
  }, [playing]);

  async function play(lesson: SavedLesson) {
    const url = await offlineUrl(lesson.id);
    if (url) setPlaying({ lesson, url });
    else await removeLesson(lesson.id);
  }

  const bytes = lessons?.reduce((sum, lesson) => sum + (lesson.bytes ?? 0), 0) ?? 0;

  return (
    <div className="pb-14">
      <section className="band relative isolate overflow-hidden">
        <div className="app-shell relative py-8 sm:py-10">
          <p className="inline-flex items-center gap-2 text-[11px] font-extrabold uppercase tracking-[0.17em] text-[var(--color-peach)]">
            <WifiOff aria-hidden="true" className="size-3.5" />
            {t("savedEyebrow")}
          </p>
          <h1 className="mt-2 text-[1.75rem] font-extrabold tracking-[-0.035em] text-white sm:text-4xl">{t("savedTitle")}</h1>
          <p className="mt-2 max-w-[56ch] text-sm text-white/75">{t("savedIntro")}</p>
          {lessons?.length ? (
            <p className="mt-4 inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1.5 text-xs font-semibold text-white">
              <HardDrive aria-hidden="true" className="size-3.5" />
              {t("savedSpace", { count: lessons.length, mb: Math.max(1, Math.round(bytes / 1024 ** 2)) })}
            </p>
          ) : null}
        </div>
      </section>

      <section className="app-shell mt-8">
        {playing ? (
          <div className="mb-6 overflow-hidden rounded-3xl bg-black shadow-[var(--shadow-lg)]">
            <div className="flex items-center justify-between gap-3 bg-[var(--color-brand-deep)] px-4 py-2.5 text-white">
              <p className="min-w-0 truncate text-sm font-bold">{playing.lesson.title}</p>
              <button
                type="button"
                onClick={() => setPlaying(null)}
                aria-label={t("closePlayer")}
                className="grid size-9 place-items-center rounded-full hover:bg-white/10"
              >
                <X aria-hidden="true" className="size-4" />
              </button>
            </div>
            <video
              ref={player}
              src={playing.url}
              controls
              autoPlay
              playsInline
              poster={playing.lesson.poster ?? undefined}
              className="aspect-video w-full"
            />
          </div>
        ) : null}

        {lessons === null ? null : lessons.length === 0 ? (
          <div className="mx-auto max-w-md rounded-3xl border border-dashed border-[var(--color-border-strong)] p-8 text-center">
            <span className="mx-auto grid size-14 place-items-center rounded-2xl bg-[var(--color-brand-soft)] text-[var(--color-brand)]">
              <WifiOff aria-hidden="true" className="size-7" />
            </span>
            <h2 className="mt-4 text-lg font-extrabold">{t("savedNoneTitle")}</h2>
            <p className="mt-1.5 text-sm text-[var(--color-muted-foreground)]">{t("savedNoneBody")}</p>
            <Link
              href="/learn"
              className="mt-5 inline-flex min-h-11 items-center rounded-full bg-[var(--color-brand)] px-5 text-sm font-bold text-white hover:bg-[var(--color-brand-strong)]"
            >
              {t("browse")}
            </Link>
          </div>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {lessons.map((lesson) => (
              <li
                key={lesson.id}
                className="flex items-center gap-3 rounded-2xl border border-[var(--color-border)] bg-[var(--color-card)] p-3 shadow-[var(--shadow-card)]"
              >
                <button
                  type="button"
                  onClick={() => void play(lesson)}
                  aria-label={t("playSaved", { title: lesson.title })}
                  className="group relative grid aspect-video w-28 shrink-0 place-items-center overflow-hidden rounded-xl bg-[var(--color-brand-deep)]"
                >
                  {lesson.poster ? (
                    // A kept still may be all there is with no signal; next/image would fetch.
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={lesson.poster} alt="" className="absolute inset-0 size-full object-cover opacity-80" />
                  ) : null}
                  <span className="relative grid size-9 place-items-center rounded-full bg-white/95 text-[var(--color-brand)] transition-transform group-hover:scale-110">
                    <Play aria-hidden="true" className="ml-0.5 size-4 fill-current" />
                  </span>
                </button>
                <div className="min-w-0 flex-1">
                  <p className="line-clamp-2 text-sm font-bold leading-snug">{lesson.title}</p>
                  <p className="mt-0.5 truncate text-xs text-[var(--color-muted-foreground)]">{lesson.course.name}</p>
                  <p className="mt-1 text-xs text-[var(--color-muted-foreground)]">
                    {lesson.duration_seconds ? clock(lesson.duration_seconds) : null}
                    {lesson.bytes ? ` · ${Math.max(1, Math.round(lesson.bytes / 1024 ** 2))} MB` : null}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => void removeLesson(lesson.id)}
                  aria-label={t("removeSaved", { title: lesson.title })}
                  className="grid size-10 shrink-0 place-items-center rounded-full text-[var(--color-muted-foreground)] hover:bg-[var(--color-muted)] hover:text-[var(--color-destructive)]"
                >
                  <Trash2 aria-hidden="true" className="size-4" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
