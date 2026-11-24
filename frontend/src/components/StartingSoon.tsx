import Link from "next/link";
import { useTranslations } from "next-intl";

import { notPast } from "@/lib/format";
import type { UpcomingIntake } from "@/lib/types";

const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

/**
 * "Starting soon" as a small card: the date, the course, the workshop and how
 * many places are left. Beside the headline on the training page's wide
 * screen, under the search on a phone. Server-rendered, no script.
 */
export function StartingSoon({
  intakes: given,
  title,
  allLabel,
}: {
  intakes: UpcomingIntake[];
  title: string;
  allLabel: string;
}) {
  const t = useTranslations("SearchPage");
  const intakes = given.filter((intake) => notPast(intake.start_date)).slice(0, 3);
  if (intakes.length === 0) return null;
  return (
    <section aria-label={title} className="rounded-xl border border-[var(--color-border)] bg-[var(--color-card)] p-4">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-sm font-semibold">{title}</h2>
        <Link href="#search-results-heading" className="text-xs font-semibold text-[var(--color-brand)] hover:underline">
          {allLabel}
        </Link>
      </div>
      <ol className="mt-3 grid grid-cols-[minmax(0,1fr)] gap-1.5">
        {intakes.map((intake, index) => {
          // "2026-12-07", read as written, so no time zone moves the day.
          const [, month, day] = intake.start_date.split("-");
          return (
            <li key={`${intake.slug}-${intake.start_date}-${index}`}>
              <Link
                href={`/${intake.area_slug}/${intake.slug}`}
                prefetch={false}
                className="flex min-w-0 items-center gap-3 rounded-lg p-1 hover:bg-[var(--color-muted)]"
              >
                <time
                  dateTime={intake.start_date}
                  className="grid w-11 shrink-0 rounded-md border border-[var(--color-border)] bg-[var(--color-muted)] py-1 text-center leading-none"
                >
                  <span className="text-[9.5px] font-semibold tracking-wide text-[var(--color-muted-foreground)]">
                    {MONTHS[Number(month) - 1]}
                  </span>
                  <span className="mt-0.5 text-base font-semibold tabular-nums">{day}</span>
                </time>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13.5px] font-semibold">{intake.course}</span>
                  <span className="block truncate text-xs text-[var(--color-muted-foreground)]">
                    {intake.provider} · {intake.area}
                  </span>
                </span>
                <span className="shrink-0 text-xs font-semibold">
                  {intake.places_remaining === null
                    ? t("boardOpen")
                    : t("boardPlaces", { count: intake.places_remaining })}
                </span>
              </Link>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
