import { Clock3, PlayCircle } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useTranslations } from "next-intl";

import { formatCedis } from "@/lib/format";
import type { CourseCard } from "@/lib/types";

/**
 * One course in a list: a still, the workshop, and how long it all is.
 * Nothing plays from here; the player is on the course's own page.
 */
export function CourseTile({ course }: { course: CourseCard }) {
  const t = useTranslations("Learn");
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
        {/* What it costs, before anybody opens it. */}
        <span className="absolute left-2 top-2 rounded-full bg-[var(--color-card)] px-2.5 py-1 text-xs font-extrabold text-[var(--color-brand-deep)] shadow-sm">
          {course.price ? formatCedis(course.price) : t("free")}
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
