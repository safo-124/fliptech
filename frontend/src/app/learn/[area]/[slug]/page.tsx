/**
 * One course: a workshop's approved lessons, in order, at
 * /learn/<area>/<workshop>. The same address shape as the workshop's own
 * listing, under /learn, so one is always a link away from the other.
 */

import { ArrowLeft, ArrowRight, Clock3, MapPin, ShieldCheck, Tag } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { CoursePlayer } from "@/components/CoursePlayer";
import { CourseTile } from "@/components/CourseTile";
import { Button } from "@/components/ui/button";
import { ApiError, getCourse, listCourses } from "@/lib/api";
import { BRAND } from "@/lib/brand";
import { formatCedis, videoCost } from "@/lib/format";
import { tradeClass } from "@/lib/trades";
import type { CourseCard } from "@/lib/types";

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

/** How many other courses the foot of the page suggests. */
const MORE = 3;

export default async function CoursePage({ params }: { params: Promise<Params> }) {
  const { area, slug } = await params;
  const [data, t, tProfile] = await Promise.all([
    load(area, slug),
    getTranslations("Learn"),
    getTranslations("ProviderProfile"),
  ]);
  if (!data) notFound();
  const { course, lessons } = data;

  // Other courses: the same trade first, then anything, never this one.
  const [sameTrade, everything] = await Promise.all([
    course.trade ? listCourses({ trade: course.trade.slug }).catch(() => null) : null,
    listCourses().catch(() => null),
  ]);
  const others: CourseCard[] = [];
  for (const candidate of [...(sameTrade?.results ?? []), ...(everything?.results ?? [])]) {
    if (candidate.id !== course.id && !others.some((seen) => seen.id === candidate.id)) {
      others.push(candidate);
    }
  }
  const more = others.slice(0, MORE);

  const seconds = course.total_seconds ?? 0;
  const length =
    seconds >= 3600
      ? t("lengthHours", { count: course.lessons, hours: (seconds / 3600).toFixed(1) })
      : t("lengthMinutes", { count: course.lessons, minutes: Math.max(1, Math.round(seconds / 60)) });
  const workshopHref = `/${course.area_slug}/${course.slug}`;

  return (
    <div className="pb-14">
      {/* ----------------------------------------------------------- header */}
      <section className="hero-wash border-b border-[var(--color-brand)]/10">
        <div className="app-shell mx-auto max-w-6xl py-6 sm:py-8">
          <Link
            href="/learn"
            className="inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-[var(--color-foreground)]/70 hover:text-[var(--color-brand)]"
          >
            <ArrowLeft aria-hidden="true" className="size-4" />
            {t("allCourses")}
          </Link>

          <div className="mt-2 flex flex-wrap items-end justify-between gap-x-8 gap-y-5">
            <div className="min-w-0">
              {course.trade ? (
                <span
                  className={`${tradeClass(course.trade.colour)} inline-flex rounded-full bg-[var(--trade-bg)] px-3 py-1 text-xs font-bold text-[var(--trade-fg)]`}
                >
                  {course.trade.name}
                </span>
              ) : null}
              <h1 className="mt-3 text-[1.9rem] font-extrabold leading-[1.1] tracking-[-0.035em] text-[var(--color-brand-deep)] sm:text-4xl">
                {course.name}
              </h1>
              <p className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm text-[var(--color-foreground)]/75">
                <span className="inline-flex items-center gap-1.5">
                  <MapPin aria-hidden="true" className="size-4 text-[var(--color-brand)]" />
                  {course.area}
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <Clock3 aria-hidden="true" className="size-4 text-[var(--color-brand)]" />
                  {length}
                </span>
                <span className="inline-flex items-center gap-1.5 font-bold text-[var(--color-brand-deep)]">
                  <Tag aria-hidden="true" className="size-4 text-[var(--color-brand)]" />
                  {course.price ? t("priceLine", { price: formatCedis(course.price) }) : t("free")}
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <ShieldCheck aria-hidden="true" className="size-4 text-[var(--color-visit)]" />
                  {t("watchedBy", { brand: BRAND })}
                </span>
              </p>
            </div>
            {/* Short, and full width on a phone: the longer wording is in the
                "learn in person" panel below, where there is room for it. */}
            <Button asChild variant="outline" size="lg" className="w-full sm:w-auto">
              <Link href={workshopHref}>
                {t("seeWorkshop")}
                <ArrowRight aria-hidden="true" />
              </Link>
            </Button>
          </div>
        </div>
      </section>

      {/* ----------------------------------------------------------- player */}
      {/* Capped at 6xl: on a wide screen a full-width video is taller than
          the window, and the lesson's title and buttons fall below it. */}
      <section className="app-shell mx-auto mt-6 max-w-6xl sm:mt-8">
        <CoursePlayer
          course={{ area: course.area_slug, slug: course.slug, paid: Boolean(course.price) }}
          lessons={lessons.map((video) => {
            const cost = videoCost(video);
            return {
              video,
              playLabel: tProfile("playVideo", { title: video.title }),
              // A locked lesson's size is withheld with its files: its
              // length is still worth saying.
              meta: cost
                ? tProfile("videoMeta", cost)
                : video.locked && video.duration_seconds
                  ? t("lessonLength", { minutes: Math.max(1, Math.round(video.duration_seconds / 60)) })
                  : tProfile("videoDataCost"),
            };
          })}
          labels={{
            contents: t("contents"),
            summary: length,
            quality: tProfile("videoQuality"),
            previous: t("previousLesson"),
            next: t("nextLesson"),
            lessonNumber: lessons.map((_, position) =>
              t("lessonNumber", { number: position + 1, count: lessons.length }),
            ),
            locked: course.price
              ? {
                  title: t("lockedTitle"),
                  body: t("lockedBody", { price: formatCedis(course.price), count: lessons.length }),
                  buy: t("buy", { price: formatCedis(course.price) }),
                  buying: t("buying"),
                  signIn: t("signInToBuy"),
                  checking: t("checkingPayment"),
                  unavailable: t("buyUnavailable"),
                  failed: t("paymentNotConfirmed"),
                  preview: t("freePreview"),
                }
              : undefined,
          }}
        />
      </section>

      {/* ------------------------------------------------- about the workshop */}
      <section className="app-shell mx-auto mt-10 max-w-6xl">
        <div className="hero-wash flex flex-wrap items-center justify-between gap-5 rounded-2xl border border-[var(--color-brand)]/15 p-5 sm:p-6">
          <div className="max-w-[60ch]">
            <h2 className="text-lg font-extrabold tracking-[-0.02em] text-[var(--color-brand-deep)]">
              {t("aboutTitle", { name: course.name })}
            </h2>
            <p className="mt-1.5 text-sm leading-relaxed text-[var(--color-foreground)]/75">
              {t("aboutBody", { area: course.area })}
            </p>
          </div>
          <Button asChild variant="brand" size="lg">
            <Link href={workshopHref}>
              {t("aboutAction")}
              <ArrowRight aria-hidden="true" />
            </Link>
          </Button>
        </div>
        <p className="mt-4 max-w-[70ch] text-xs leading-relaxed text-[var(--color-muted-foreground)]">
          {t("reviewed", { brand: BRAND })}
        </p>
      </section>

      {/* ------------------------------------------------------ more courses */}
      {more.length ? (
        <section className="app-shell mx-auto mt-12 max-w-6xl">
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <h2 className="text-xl font-extrabold tracking-[-0.03em] text-[var(--color-brand-deep)] sm:text-2xl">
              {t("moreTitle")}
            </h2>
            <Link
              href="/learn"
              className="inline-flex items-center gap-1 text-[13px] font-bold text-[var(--color-brand)] hover:underline"
            >
              {t("allCourses")}
              <ArrowRight aria-hidden="true" className="size-3.5" />
            </Link>
          </div>
          <ul className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {more.map((other) => (
              <li key={other.id}>
                <CourseTile course={other} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
