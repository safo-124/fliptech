"use client";

import {ArrowRight, Award, BookOpen, Bookmark, GraduationCap, PlayCircle} from "lucide-react";
import Link from "next/link";
import {useTranslations} from "next-intl";
import {useEffect, useState} from "react";

import {Card, CardContent, CardHeader, CardTitle} from "@/components/ui/card";
import {getMyCourses} from "@/lib/course-api";
import type {MyCourse} from "@/lib/types";

/**
 * The learning half of /account, next to the shopping half: courses in
 * progress with a way back in, certificates, saved lessons. The same login
 * as everything else, so nothing to sign in to again.
 */
export function LearningCard() {
  const t = useTranslations("Account");
  const [courses, setCourses] = useState<MyCourse[] | null>(null);

  useEffect(() => {
    let active = true;
    getMyCourses()
      .then((found) => active && setCourses(found.results))
      .catch(() => active && setCourses([]));
    return () => {
      active = false;
    };
  }, []);

  const going = (courses ?? []).filter((item) => !item.certificate).slice(0, 3);
  const certificates = (courses ?? []).filter((item) => item.certificate).length;

  return (
    <Card id="learning" className="scroll-mt-24">
      <CardHeader className="flex-row items-center gap-3 space-y-0">
        <GraduationCap aria-hidden="true" className="size-5 text-[var(--color-brand)]" />
        <CardTitle>{t("learningTitle")}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {courses === null ? (
          <div className="h-16 animate-pulse rounded-xl bg-[var(--color-muted)]" />
        ) : going.length ? (
          <ul className="space-y-2">
            {going.map((item) => {
              const percent = item.total ? Math.round((item.done / item.total) * 100) : 0;
              return (
                <li key={item.course.id}>
                  <Link
                    href={`/learn/${item.course.area_slug}/${item.course.slug}`}
                    className="flex items-center gap-3 rounded-xl border border-[var(--color-border)] p-3 hover:bg-[var(--color-brand-soft)]"
                  >
                    <PlayCircle aria-hidden className="size-8 shrink-0 text-[var(--color-brand)]" />
                    <span className="min-w-0 flex-1">
                      <b className="block truncate text-sm">{item.course.name}</b>
                      <span className="mt-1.5 block h-1.5 overflow-hidden rounded-full bg-[var(--color-muted)]">
                        <span
                          className="block h-full rounded-full bg-[var(--color-brand)]"
                          style={{width: `${percent}%`}}
                        />
                      </span>
                      <small className="mt-1 block text-xs text-[var(--color-muted-foreground)]">
                        {t("learningProgress", {done: item.done, total: item.total})}
                      </small>
                    </span>
                    <span className="shrink-0 text-sm font-semibold text-[var(--color-brand)]">
                      {t("learningContinue")}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        ) : (
          <Link
            href="/learn"
            className="flex items-center gap-3 rounded-xl bg-[var(--color-brand-soft)] p-4 hover:opacity-90"
          >
            <PlayCircle aria-hidden className="size-8 shrink-0 text-[var(--color-brand)]" />
            <span className="flex-1">
              <b className="block text-sm">{t("learningEmptyTitle")}</b>
              <small className="block text-xs text-[var(--color-muted-foreground)]">{t("learningEmptyLead")}</small>
            </span>
            <ArrowRight aria-hidden className="size-4 text-[var(--color-brand)]" />
          </Link>
        )}
        <div className="flex flex-wrap gap-x-5 gap-y-1">
          <Link href="/learn/mine" className="inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-[var(--color-brand)] hover:underline">
            <BookOpen aria-hidden className="size-4" />
            {t("learningAll")}
          </Link>
          {certificates ? (
            <Link href="/learn/mine" className="inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-[var(--color-brand)] hover:underline">
              <Award aria-hidden className="size-4" />
              {t("learningCertificates", {count: certificates})}
            </Link>
          ) : null}
          <Link href="/learn/saved" className="inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-[var(--color-brand)] hover:underline">
            <Bookmark aria-hidden className="size-4" />
            {t("learningSaved")}
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}
