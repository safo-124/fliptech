"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";

import type { StudioStats } from "@/lib/types";

/** Round a top value up to a clean axis maximum: 1, 2, 5, 10, 20, 50… */
function niceMax(value: number) {
  if (value <= 4) return 4;
  const power = 10 ** Math.floor(Math.log10(value));
  for (const step of [1, 2, 2.5, 5, 10]) {
    if (value <= step * power) return step * power;
  }
  return 10 * power;
}

function shortDay(iso: string) {
  return new Date(`${iso}T12:00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

/**
 * Plays per day for the last 30 days: one series, so no legend; the heading
 * names it. Columns from one baseline, 4px rounded caps, a hairline grid,
 * and a tooltip per column. The same numbers are in a table underneath.
 */
export function PlaysChart({ daily }: { daily: StudioStats["daily"] }) {
  const t = useTranslations("CourseStudio");
  const [hover, setHover] = useState<number | null>(null);
  const top = niceMax(Math.max(...daily.map((d) => d.plays), 0));
  const ticks = [0, top / 2, top];
  const height = 160;

  return (
    <figure className="m-0">
      <div className="relative flex gap-2">
        {/* y axis */}
        <div aria-hidden="true" className="relative w-7 shrink-0 text-right text-[11px] tabular-nums text-[var(--color-muted-foreground)]" style={{ height }}>
          {ticks.map((tick) => (
            <span key={tick} className="absolute right-0 -translate-y-1/2" style={{ top: height - (tick / top) * height }}>
              {tick % 1 ? tick.toFixed(1) : tick}
            </span>
          ))}
        </div>
        <div className="relative min-w-0 flex-1" style={{ height }}>
          {ticks.map((tick) => (
            <span
              key={tick}
              aria-hidden="true"
              className="absolute inset-x-0 h-px bg-[var(--color-border)]"
              style={{ top: height - (tick / top) * height }}
            />
          ))}
          <ol className="absolute inset-0 flex items-end gap-[2px]" aria-hidden="true">
            {daily.map((day, n) => (
              <li
                key={day.day}
                className="relative flex h-full flex-1 items-end justify-center"
                onPointerEnter={() => setHover(n)}
                onPointerLeave={() => setHover(null)}
              >
                <span
                  className="block w-full max-w-6 rounded-t-[4px] bg-[var(--color-brand-violet)] transition-opacity"
                  style={{
                    height: day.plays ? Math.max(2, (day.plays / top) * height) : 0,
                    opacity: hover === null || hover === n ? 1 : 0.45,
                  }}
                />
              </li>
            ))}
          </ol>
          {hover !== null ? (
            <div
              role="status"
              className="pointer-events-none absolute -top-2 z-10 -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-lg bg-[var(--color-brand-deep)] px-2.5 py-1.5 text-xs text-white shadow-lg"
              style={{ left: `${((hover + 0.5) / daily.length) * 100}%` }}
            >
              <span className="font-semibold">{shortDay(daily[hover].day)}</span> ·{" "}
              {t("playsCount", { count: daily[hover].plays })}
            </div>
          ) : null}
        </div>
      </div>
      <div aria-hidden="true" className="ml-9 mt-1.5 flex justify-between text-[11px] text-[var(--color-muted-foreground)]">
        <span>{shortDay(daily[0].day)}</span>
        <span>{shortDay(daily[Math.floor(daily.length / 2)].day)}</span>
        <span>{t("today")}</span>
      </div>
      <details className="mt-3 text-sm">
        <summary className="cursor-pointer text-xs font-semibold text-[var(--color-muted-foreground)]">
          {t("showTable")}
        </summary>
        <table className="mt-2 w-full text-left text-xs">
          <thead>
            <tr className="text-[var(--color-muted-foreground)]">
              <th className="py-1 font-semibold">{t("day")}</th>
              <th className="py-1 text-right font-semibold">{t("plays")}</th>
            </tr>
          </thead>
          <tbody>
            {[...daily].reverse().map((day) => (
              <tr key={day.day} className="border-t border-[var(--color-border)]">
                <td className="py-1">{shortDay(day.day)}</td>
                <td className="py-1 text-right tabular-nums">{day.plays}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  );
}

/**
 * Each lesson: how often it was played (the bar), and how many who started
 * it finished it (the words beside it), so a lesson people stop in shows.
 */
export function LessonFunnel({ lessons }: { lessons: StudioStats["lessons"] }) {
  const t = useTranslations("CourseStudio");
  const top = Math.max(1, ...lessons.map((lesson) => lesson.plays));
  return (
    <ol className="space-y-3">
      {lessons.map((lesson, n) => {
        const kept = lesson.started ? Math.round((lesson.finished / lesson.started) * 100) : null;
        const low = kept !== null && lesson.started >= 3 && kept < 50;
        return (
          <li key={lesson.id} className="group">
            <div className="flex items-baseline justify-between gap-3 text-sm">
              <span className="min-w-0 truncate font-semibold">
                <span className="mr-1.5 tabular-nums text-[var(--color-muted-foreground)]">{n + 1}.</span>
                {lesson.title}
              </span>
              <span className="shrink-0 text-xs text-[var(--color-muted-foreground)]">
                {kept === null
                  ? t("notStarted")
                  : t("finishedShare", { finished: lesson.finished, started: lesson.started, percent: kept })}
                {low ? <span className="ml-1.5 rounded bg-[var(--color-warn-bg)] px-1.5 py-0.5 font-bold text-[var(--color-warn)]">{t("dropOff")}</span> : null}
              </span>
            </div>
            <div className="mt-1.5 flex items-center gap-2">
              <span className="h-3 flex-1 rounded-r-[4px] bg-[var(--color-muted)]/60">
                <span
                  className="block h-full rounded-r-[4px] bg-[var(--color-brand-violet)] transition-[width] duration-700"
                  style={{ width: `${(lesson.plays / top) * 100}%` }}
                />
              </span>
              <span className="w-12 shrink-0 text-right text-xs font-bold tabular-nums">{lesson.plays}</span>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
