/**
 * Online learning: every workshop's teaching videos, one course per workshop.
 *
 * A Server Component with trade filters as plain links, so browsing works
 * with no JavaScript. Nothing here plays: a card shows a still, how many
 * lessons and how long, and the player is one page deeper, where a tap
 * decides whether any data is spent.
 *
 * Only videos staff have watched, from workshops that are live. See
 * backend/providers/learning.py.
 */

import { Clock3, PlayCircle, Video } from "lucide-react";
import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { getTranslations } from "next-intl/server";

import { BrandShards } from "@/components/BrandShards";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { getAllTrades, listCourses } from "@/lib/api";
import { BRAND } from "@/lib/brand";
import type { CourseCard } from "@/lib/types";

export const revalidate = 300;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Learn");
  return { title: t("metaTitle"), description: t("metaDescription", { brand: BRAND }) };
}

export default async function LearnPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const raw = await searchParams;
  const trade = typeof raw.trade === "string" ? raw.trade : undefined;

  const [courses, trades, t] = await Promise.all([
    listCourses({ trade }).catch(() => null),
    getAllTrades().catch(() => []),
    getTranslations("Learn"),
  ]);
  const results = courses?.results ?? [];

  return (
    <div className="pb-14">
      <section className="band relative isolate overflow-hidden">
        <BrandShards className="pointer-events-none absolute -right-8 -top-12 h-[16rem] w-[22rem] opacity-25" />
        <div className="app-shell relative z-10 py-8 sm:py-12">
          <p className="text-[11px] font-extrabold uppercase tracking-[0.17em] text-[var(--color-peach)]">
            {t("eyebrow")}
          </p>
          <h1 className="mt-2 max-w-[20ch] text-[1.75rem] font-extrabold leading-[1.12] tracking-[-0.035em] text-white sm:text-4xl">
            {t("title")}
          </h1>
          <p className="mt-3 max-w-[56ch] text-sm leading-relaxed text-white/75 sm:text-base">
            {t("intro", { brand: BRAND })}
          </p>

          {trades.length ? (
            <nav aria-label={t("tradeFilter")} className="mt-6 flex flex-wrap gap-2">
              <TradeLink href="/learn" active={!trade} label={t("allTrades")} />
              {trades.map((option) => (
                <TradeLink
                  key={option.slug}
                  href={`/learn?trade=${option.slug}`}
                  active={trade === option.slug}
                  label={option.name}
                />
              ))}
            </nav>
          ) : null}
        </div>
      </section>

      <section className="app-shell mt-8">
        {courses === null ? (
          <Card className="p-8 text-center">
            <p className="text-sm text-[var(--color-muted-foreground)]">{t("unavailable")}</p>
          </Card>
        ) : results.length === 0 ? (
          <Card className="p-8 text-center sm:p-12">
            <span className="mx-auto grid size-12 place-items-center rounded-2xl bg-[var(--color-muted)] text-[var(--color-muted-foreground)]">
              <Video aria-hidden="true" className="size-6" />
            </span>
            <h2 className="mt-4 text-lg font-bold tracking-[-0.02em]">
              {trade ? t("noneMatch") : t("noneYet")}
            </h2>
            <p className="mx-auto mt-2 max-w-[48ch] text-sm leading-relaxed text-[var(--color-muted-foreground)]">
              {trade ? t("noneMatchBody") : t("noneYetBody", { brand: BRAND })}
            </p>
            {trade ? (
              <Button asChild variant="outline" className="mt-5">
                <Link href="/learn">{t("allTrades")}</Link>
              </Button>
            ) : (
              <Button asChild variant="brand" className="mt-5">
                <Link href="/trainer/dashboard#videos">{t("teachHere")}</Link>
              </Button>
            )}
          </Card>
        ) : (
          <>
            <p className="mb-4 text-sm text-[var(--color-muted-foreground)]">
              {t("count", { count: courses.count })}
            </p>
            <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {results.map((course) => (
                <li key={course.id}>
                  <CourseTile course={course} t={t} />
                </li>
              ))}
            </ul>
          </>
        )}
      </section>
    </div>
  );
}

function TradeLink({ href, active, label }: { href: string; active: boolean; label: string }) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className="rounded-full border border-white/25 px-3.5 py-1.5 text-sm font-semibold text-white/85 transition-colors hover:bg-white/10 aria-[current=page]:border-transparent aria-[current=page]:bg-white aria-[current=page]:text-[var(--color-brand-strong)]"
    >
      {label}
    </Link>
  );
}

function CourseTile({
  course,
  t,
}: {
  course: CourseCard;
  t: Awaited<ReturnType<typeof getTranslations<"Learn">>>;
}) {
  const hours = (course.total_seconds ?? 0) / 3600;
  return (
    <Link
      href={`/learn/${course.area_slug}/${course.slug}`}
      className="group block h-full overflow-hidden rounded-2xl border border-[var(--color-border)] bg-[var(--color-card)] transition-[border-color,box-shadow,transform] hover:-translate-y-0.5 hover:border-[var(--color-brand)]/30 hover:shadow-[var(--shadow-card)]"
    >
      <div className="relative grid aspect-video place-items-center bg-black text-white/70">
        {course.poster ? (
          <Image
            src={course.poster}
            alt=""
            fill
            className="object-cover opacity-90 transition-opacity group-hover:opacity-100"
            sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 400px"
          />
        ) : null}
        <span aria-hidden="true" className="relative grid size-12 place-items-center rounded-full bg-black/60 text-white ring-2 ring-white/80">
          <PlayCircle className="size-6" />
        </span>
      </div>
      <div className="space-y-1.5 p-4">
        {course.trade ? (
          <p className="text-xs font-bold uppercase tracking-[0.08em] text-[var(--color-muted-foreground)]">
            {course.trade.name}
          </p>
        ) : null}
        <h2 className="font-bold leading-snug tracking-[-0.015em]">{course.name}</h2>
        <p className="text-sm text-[var(--color-muted-foreground)]">{course.area}</p>
        <p className="flex items-center gap-1.5 text-xs text-[var(--color-muted-foreground)]">
          <Clock3 aria-hidden="true" className="size-3.5" />
          {hours >= 1
            ? t("lengthHours", { count: course.lessons, hours: hours.toFixed(1) })
            : t("lengthMinutes", {
                count: course.lessons,
                minutes: Math.max(1, Math.round((course.total_seconds ?? 0) / 60)),
              })}
        </p>
      </div>
    </Link>
  );
}
