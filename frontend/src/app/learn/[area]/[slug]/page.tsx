/**
 * One course: a workshop's approved lessons, in order, at
 * /learn/<area>/<workshop>. The same address shape as the workshop's own
 * listing, under /learn, so one is always a link away from the other.
 */

import { ArrowLeft, ArrowRight } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { CoursePlayer } from "@/components/CoursePlayer";
import { ApiError, getCourse } from "@/lib/api";
import { BRAND } from "@/lib/brand";
import { videoCost } from "@/lib/format";

export const revalidate = 300;

type Params = { area: string; slug: string };

async function load(area: string, slug: string) {
  try {
    return await getCourse(area, slug);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return null;
    throw error;
  }
}

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { area, slug } = await params;
  const [data, t] = await Promise.all([load(area, slug).catch(() => null), getTranslations("Learn")]);
  if (!data) return { title: t("notFound") };
  return {
    title: t("courseMetaTitle", { name: data.course.name }),
    description: t("courseMetaDescription", {
      name: data.course.name,
      area: data.course.area,
      count: data.course.lessons,
      brand: BRAND,
    }),
    alternates: { canonical: `/learn/${area}/${slug}` },
  };
}

export default async function CoursePage({ params }: { params: Promise<Params> }) {
  const { area, slug } = await params;
  const [data, t, tProfile] = await Promise.all([
    load(area, slug),
    getTranslations("Learn"),
    getTranslations("ProviderProfile"),
  ]);
  if (!data) notFound();
  const { course, lessons } = data;

  return (
    <div className="app-shell pb-14 pt-6 sm:pt-8">
      <Link
        href="/learn"
        className="inline-flex items-center gap-1.5 text-sm font-semibold text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]"
      >
        <ArrowLeft aria-hidden="true" className="size-4" />
        {t("allCourses")}
      </Link>

      <header className="mt-4">
        {course.trade ? (
          <p className="text-xs font-bold uppercase tracking-[0.08em] text-[var(--color-muted-foreground)]">
            {course.trade.name}
          </p>
        ) : null}
        <h1 className="mt-1 text-2xl font-extrabold tracking-[-0.03em] sm:text-3xl">{course.name}</h1>
        <p className="mt-1 text-sm text-[var(--color-muted-foreground)]">
          {t("courseByline", { area: course.area, count: course.lessons })}
        </p>
        <Link
          href={`/${course.area_slug}/${course.slug}`}
          className="mt-3 inline-flex items-center gap-1.5 text-sm font-semibold text-[var(--color-brand-strong)] hover:underline"
        >
          {t("visitWorkshop")}
          <ArrowRight aria-hidden="true" className="size-4" />
        </Link>
      </header>

      <div className="mt-6">
        <CoursePlayer
          lessons={lessons.map((video) => {
            const cost = videoCost(video);
            return {
              video,
              playLabel: tProfile("playVideo", { title: video.title }),
              meta: cost ? tProfile("videoMeta", cost) : tProfile("videoDataCost"),
            };
          })}
          labels={{
            lessons: t("lessons"),
            quality: tProfile("videoQuality"),
            next: t("nextLesson"),
            lessonNumber: lessons.map((_, position) =>
              t("lessonNumber", { number: position + 1, count: lessons.length }),
            ),
          }}
        />
      </div>

      <p className="mt-8 max-w-[60ch] text-xs leading-relaxed text-[var(--color-muted-foreground)]">
        {t("reviewed", { brand: BRAND })}
      </p>
    </div>
  );
}
