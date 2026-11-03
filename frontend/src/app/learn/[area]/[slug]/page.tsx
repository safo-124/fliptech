/**
 * One course: a workshop's approved lessons, in the trainer's order, at
 * /learn/<area>/<workshop>. The same address shape as the workshop's own
 * listing, under /learn, so one is always a link away from the other.
 *
 * The page is cached and the same for everybody. The classroom inside it
 * (components/learn/Classroom.tsx) asks, once loaded, what this browser may
 * watch and how far it has got.
 */

import {
  ArrowLeft,
  ArrowRight,
  BarChart3,
  CheckCircle2,
  Clock3,
  MapPin,
  ShieldCheck,
  Sparkles,
  Star,
  Wrench,
} from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { CourseTile } from "@/components/CourseTile";
import { CourseShop } from "@/components/marketplace/CourseShop";
import { Classroom } from "@/components/learn/Classroom";
import { Button } from "@/components/ui/button";
import { ClientMessages } from "@/i18n/ClientMessages";
import { LEARN_CLIENT_NAMESPACES } from "@/i18n/namespaces";
import { ApiError, getCourse, listCourses } from "@/lib/api";
import { BRAND } from "@/lib/brand";
import { formatCedis } from "@/lib/format";
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
    description:
      data.details.summary ||
      t("courseMetaDescription", {
        name: data.course.name,
        area: data.course.area,
        count: data.course.lessons,
        brand: BRAND,
      }),
    alternates: { canonical: `/learn/${area}/${slug}` },
    openGraph: data.course.poster ? { images: [data.course.poster] } : undefined,
  };
}

/** How many other courses the foot of the page suggests. */
const MORE = 3;

export default async function CoursePage({ params }: { params: Promise<Params> }) {
  const { area, slug } = await params;
  const [data, t] = await Promise.all([load(area, slug), getTranslations("Learn")]);
  if (!data) notFound();
  const { course, details, ratings } = data;

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
      <section className="band relative isolate overflow-hidden">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -right-24 -top-24 size-80 rounded-full bg-[var(--color-brand-pink)]/25 blur-3xl"
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -bottom-32 left-1/3 size-72 rounded-full bg-[var(--color-brand-violet)]/30 blur-3xl"
        />
        <div className="app-shell relative mx-auto max-w-6xl py-6 sm:py-9">
          <Link
            href="/learn"
            className="inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-white/75 hover:text-white"
          >
            <ArrowLeft aria-hidden="true" className="size-4" />
            {t("allCourses")}
          </Link>

          <div className="mt-2 grid gap-6 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                {course.trade ? (
                  <span
                    className={`${tradeClass(course.trade.colour)} inline-flex rounded-full bg-[var(--trade-bg)] px-3 py-1 text-xs font-bold text-[var(--trade-fg)]`}
                  >
                    {course.trade.name}
                  </span>
                ) : null}
                {course.featured ? (
                  <span className="inline-flex items-center gap-1 rounded-full bg-gradient-to-r from-[var(--color-sand)] to-[var(--color-peach)] px-3 py-1 text-xs font-extrabold text-[var(--color-brand-deep)]">
                    <Sparkles aria-hidden="true" className="size-3.5" />
                    {t("featured")}
                  </span>
                ) : null}
                {course.level ? (
                  <span className="inline-flex items-center gap-1 rounded-full border border-white/25 px-3 py-1 text-xs font-bold text-white/90">
                    <BarChart3 aria-hidden="true" className="size-3.5" />
                    {t(`level.${course.level}`)}
                  </span>
                ) : null}
              </div>
              <h1 className="mt-3 max-w-[24ch] text-[2rem] font-extrabold leading-[1.08] tracking-[-0.035em] text-white sm:text-[2.6rem]">
                {course.name}
              </h1>
              {details.summary ? (
                <p className="mt-3 max-w-[62ch] text-[15px] leading-relaxed text-white/80 sm:text-base">
                  {details.summary}
                </p>
              ) : null}
              <p className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-white/85">
                {ratings.average ? (
                  <a href="#player" className="inline-flex items-center gap-1.5 font-bold text-white">
                    <Star aria-hidden="true" className="size-4 fill-[var(--color-peach)] text-[var(--color-peach)]" />
                    {ratings.average.toFixed(1)}
                    <span className="font-normal text-white/70">({t("reviewCount", { count: ratings.count })})</span>
                  </a>
                ) : null}
                <span className="inline-flex items-center gap-1.5">
                  <MapPin aria-hidden="true" className="size-4 text-[var(--color-peach)]" />
                  {course.area}
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <Clock3 aria-hidden="true" className="size-4 text-[var(--color-peach)]" />
                  {length}
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <ShieldCheck aria-hidden="true" className="size-4 text-[var(--color-peach)]" />
                  {t("watchedBy", { brand: BRAND })}
                </span>
              </p>
            </div>
            <div className="flex flex-col items-start gap-3 lg:items-end">
              <p className="flex items-baseline gap-2 text-white">
                <span className="text-3xl font-extrabold tracking-tight">
                  {course.price ? formatCedis(course.price) : t("free")}
                </span>
                {course.full_price ? (
                  <span className="text-lg text-white/60 line-through">{formatCedis(course.full_price)}</span>
                ) : null}
              </p>
              {course.price ? <p className="-mt-2 text-xs text-white/70">{t("firstLessonFree")}</p> : null}
              <Button asChild variant="onBand" size="lg" className="w-full sm:w-auto">
                <Link href={workshopHref}>
                  {t("seeWorkshop")}
                  <ArrowRight aria-hidden="true" />
                </Link>
              </Button>
            </div>
          </div>
        </div>
      </section>

      {/* -------------------------------------------------------- classroom */}
      <section className="app-shell mx-auto -mt-2 max-w-6xl pt-6 sm:pt-8">
        <ClientMessages namespaces={LEARN_CLIENT_NAMESPACES}>
          <Classroom data={data} />
        </ClientMessages>
      </section>

      {/* ------------------------------------- learn and buy, tools you need */}
      <CourseShop area={area} slug={slug} />

      {/* ------------------------------------------------- what you will learn */}
      {details.outcomes.length || details.tools.length ? (
        <section className="app-shell mx-auto mt-12 grid max-w-6xl gap-5 md:grid-cols-[3fr_2fr]">
          {details.outcomes.length ? (
            <div className="rounded-3xl border border-[var(--color-border)] bg-[var(--color-card)] p-6 shadow-[var(--shadow-card)]">
              <h2 className="text-lg font-extrabold tracking-[-0.02em] text-[var(--color-brand-deep)]">
                {t("outcomesTitle")}
              </h2>
              <ul className="mt-4 grid gap-3 sm:grid-cols-2">
                {details.outcomes.map((outcome) => (
                  <li key={outcome} className="flex gap-2.5 text-sm leading-relaxed">
                    <CheckCircle2 aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-[var(--color-visit)]" />
                    {outcome}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {details.tools.length ? (
            <div className="rounded-3xl border border-[var(--color-border)] bg-[var(--color-muted)]/50 p-6">
              <h2 className="flex items-center gap-2 text-lg font-extrabold tracking-[-0.02em] text-[var(--color-brand-deep)]">
                <Wrench aria-hidden="true" className="size-5 text-[var(--color-brand)]" />
                {t("toolsTitle")}
              </h2>
              <ul className="mt-4 space-y-2">
                {details.tools.map((tool) => (
                  <li key={tool} className="flex gap-2.5 text-sm">
                    <span aria-hidden="true" className="mt-2 size-1.5 shrink-0 rounded-full bg-[var(--color-brand)]" />
                    {tool}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </section>
      ) : null}

      {/* ------------------------------------------------- about the workshop */}
      <section className="app-shell mx-auto mt-10 max-w-6xl">
        <div className="hero-wash flex flex-wrap items-center justify-between gap-5 rounded-3xl border border-[var(--color-brand)]/15 p-5 sm:p-7">
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
