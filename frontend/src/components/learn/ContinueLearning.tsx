"use client";

import { ArrowRight, Play } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";

import { getMyCourses } from "@/lib/course-api";
import type { MyCourse } from "@/lib/types";

import { clock } from "./LessonPlayer";
import { ProgressRing } from "./ProgressRing";

/**
 * "Continue learning" on /learn: the courses this trainee has going, each a
 * tap from where they stopped. Nothing at all for anyone else.
 */
export function ContinueLearning() {
  const t = useTranslations("MyLearning");
  const [courses, setCourses] = useState<MyCourse[] | null>(null);

  useEffect(() => {
    getMyCourses()
      .then((reply) => setCourses(reply.results.filter((row) => row.done < row.total).slice(0, 6)))
      .catch(() => setCourses([]));
  }, []);

  if (!courses?.length) return null;

  return (
    <section aria-labelledby="continue-heading" className="app-shell mt-8 animate-[rise-in_0.4s_ease-out]">
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="continue-heading" className="text-xl font-extrabold tracking-[-0.03em] text-[var(--color-brand-deep)]">
          {t("continueTitle")}
        </h2>
        <Link href="/learn/mine" className="inline-flex items-center gap-1 text-sm font-bold text-[var(--color-brand)] hover:underline">
          {t("allMine")}
          <ArrowRight aria-hidden="true" className="size-4" />
        </Link>
      </div>
      <ul className="mt-4 flex snap-x gap-4 overflow-x-auto pb-2 [scrollbar-width:thin]">
        {courses.map((row) => (
          <li key={row.course.id} className="w-[min(20rem,80vw)] shrink-0 snap-start">
            <ResumeCard row={row} />
          </li>
        ))}
      </ul>
    </section>
  );
}

export function ResumeCard({ row }: { row: MyCourse }) {
  const t = useTranslations("MyLearning");
  const href = `/learn/${row.course.area_slug}/${row.course.slug}${row.resume ? `?lesson=${row.resume.id}` : ""}`;
  const share = row.total ? (row.done / row.total) * 100 : 0;
  return (
    <Link
      href={href}
      className="group flex h-full gap-3 rounded-2xl border border-[var(--color-border)] bg-[var(--color-card)] p-3 shadow-[var(--shadow-card)] transition hover:-translate-y-0.5 hover:border-[var(--color-brand)]/30"
    >
      <span className="relative block aspect-[4/3] w-24 shrink-0 overflow-hidden rounded-xl bg-[var(--color-brand-deep)]">
        {row.course.poster ? (
          <Image src={row.course.poster} alt="" fill className="object-cover" sizes="96px" />
        ) : null}
        <span aria-hidden="true" className="absolute inset-0 grid place-items-center bg-black/25 opacity-0 transition group-hover:opacity-100">
          <Play className="ml-0.5 size-6 fill-white text-white" />
        </span>
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="line-clamp-2 text-sm font-bold leading-snug">{row.course.name}</span>
        {row.resume ? (
          <span className="mt-0.5 line-clamp-1 text-xs text-[var(--color-muted-foreground)]">
            {row.resume.position > 5
              ? t("resumeAt", { title: row.resume.title, time: clock(row.resume.position) })
              : t("upNext", { title: row.resume.title })}
          </span>
        ) : null}
        <span className="mt-auto flex items-center gap-2 pt-2">
          <ProgressRing value={share} size={30} stroke={4} />
          <span className="text-xs font-semibold text-[var(--color-muted-foreground)]">
            {t("doneOf", { done: row.done, count: row.total })}
          </span>
        </span>
      </span>
    </Link>
  );
}
