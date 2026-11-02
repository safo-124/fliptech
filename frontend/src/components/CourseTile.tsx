import { BarChart3, Clock3, Play, Sparkles, Star } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useTranslations } from "next-intl";

import { formatCedis } from "@/lib/format";
import type { CourseCard } from "@/lib/types";

/**
 * One course in a list: a still, the workshop, how long it all is, what it
 * costs and what learners thought. Nothing plays from here; the player is
 * on the course's own page.
 */
export function CourseTile({ course }: { course: CourseCard }) {
  const t = useTranslations("Learn");
  const hours = (course.total_seconds ?? 0) / 3600;
  return (
    <Link
      href={`/learn/${course.area_slug}/${course.slug}`}
      className={`group flex h-full flex-col overflow-hidden rounded-2xl border bg-[var(--color-card)] transition-[border-color,box-shadow,transform] duration-300 hover:-translate-y-1 hover:shadow-[var(--shadow-lg)] ${
        course.featured
          ? "border-[var(--color-peach)] ring-1 ring-[var(--color-peach)]/60"
          : "border-[var(--color-border)] hover:border-[var(--color-brand)]/30"
      }`}
    >
      <div className="relative grid aspect-video place-items-center overflow-hidden bg-[var(--color-brand-deep)] text-white/70">
        {course.poster ? (
          <Image
            src={course.poster}
            alt=""
            fill
            className="object-cover opacity-90 transition duration-500 group-hover:scale-105 group-hover:opacity-100"
            sizes="(min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw"
          />
        ) : null}
        <span aria-hidden="true" className="absolute inset-0 bg-gradient-to-t from-black/55 via-transparent to-transparent" />
        <span
          aria-hidden="true"
          className="relative grid size-12 scale-90 place-items-center rounded-full bg-white/95 text-[var(--color-brand)] opacity-0 shadow-xl transition duration-300 group-hover:scale-100 group-hover:opacity-100"
        >
          <Play className="ml-0.5 size-5 fill-current" />
        </span>
        {/* What it costs, before anybody opens it. */}
        <span className="absolute left-2.5 top-2.5 inline-flex items-baseline gap-1.5 rounded-full bg-[var(--color-card)] px-2.5 py-1 text-xs font-extrabold text-[var(--color-brand-deep)] shadow-sm">
          {course.price ? formatCedis(course.price) : t("free")}
          {course.full_price ? (
            <span className="text-[10px] font-semibold text-[var(--color-muted-foreground)] line-through">
              {formatCedis(course.full_price)}
            </span>
          ) : null}
        </span>
        {course.featured ? (
          <span className="absolute right-2.5 top-2.5 inline-flex items-center gap-1 rounded-full bg-gradient-to-r from-[var(--color-sand)] to-[var(--color-peach)] px-2.5 py-1 text-[11px] font-extrabold text-[var(--color-brand-deep)] shadow-sm">
            <Sparkles aria-hidden="true" className="size-3" />
            {t("featured")}
          </span>
        ) : null}
        <span className="absolute bottom-2.5 left-2.5 inline-flex items-center gap-1 rounded-md bg-black/60 px-2 py-0.5 text-[11px] font-bold text-white backdrop-blur">
          <Clock3 aria-hidden="true" className="size-3" />
          {hours >= 1
            ? t("lengthHours", { count: course.lessons, hours: hours.toFixed(1) })
            : t("lengthMinutes", {
                count: course.lessons,
                minutes: Math.max(1, Math.round((course.total_seconds ?? 0) / 60)),
              })}
        </span>
      </div>
      <div className="flex flex-1 flex-col gap-1.5 p-4">
        <div className="flex items-center justify-between gap-2">
          {course.trade ? (
            <p className="truncate text-xs font-bold uppercase tracking-[0.08em] text-[var(--color-brand)]">
              {course.trade.name}
            </p>
          ) : (
            <span />
          )}
          {course.level ? (
            <span className="inline-flex shrink-0 items-center gap-1 text-[11px] font-semibold text-[var(--color-muted-foreground)]">
              <BarChart3 aria-hidden="true" className="size-3" />
              {t(`level.${course.level}`)}
            </span>
          ) : null}
        </div>
        <h2 className="font-bold leading-snug tracking-[-0.015em] group-hover:text-[var(--color-brand)]">{course.name}</h2>
        {course.summary ? (
          <p className="line-clamp-2 text-sm leading-relaxed text-[var(--color-muted-foreground)]">{course.summary}</p>
        ) : (
          <p className="text-sm text-[var(--color-muted-foreground)]">{course.area}</p>
        )}
        <p className="mt-auto flex items-center justify-between gap-2 pt-2 text-xs text-[var(--color-muted-foreground)]">
          <span className="truncate">{course.area}</span>
          {course.rating ? (
            <span className="inline-flex shrink-0 items-center gap-1 font-bold text-[var(--color-foreground)]">
              <Star aria-hidden="true" className="size-3.5 fill-[var(--color-warn)] text-[var(--color-warn)]" />
              {course.rating.toFixed(1)}
              <span className="font-normal text-[var(--color-muted-foreground)]">({course.reviews})</span>
            </span>
          ) : (
            <span className="shrink-0 font-semibold text-[var(--color-brand)]">{t("newCourse")}</span>
          )}
        </p>
      </div>
    </Link>
  );
}
