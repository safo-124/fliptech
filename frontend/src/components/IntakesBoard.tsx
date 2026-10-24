import { CalendarClock } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";

import { tradeClass } from "@/lib/trades";
import type { UpcomingIntake } from "@/lib/types";

// Built once: a formatter is not cheap, and every row asks for the same two.
const DAY = new Intl.DateTimeFormat("en-GH", { day: "2-digit", timeZone: "UTC" });
const MONTH = new Intl.DateTimeFormat("en-GH", { month: "short", timeZone: "UTC" });

/**
 * "Starting soon", as a lorry station's departures board.
 *
 * The date is the thing a trainee needs most and finds last on a listing, so
 * here it leads each row, in flip cells that fall into place as the page
 * arrives. Every row is a course someone could still join: open, with places,
 * at a published workshop. Server-rendered and a few hundred bytes: no
 * script, so the search page's budget barely notices it.
 */
export function IntakesBoard({ intakes }: { intakes: UpcomingIntake[] }) {
  const t = useTranslations("SearchPage");
  if (intakes.length === 0) return null;

  return (
    <section aria-labelledby="intakes-board-heading" className="band overflow-hidden rounded-2xl px-4 py-3.5 sm:px-5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h2
          id="intakes-board-heading"
          className="flex items-center gap-2 text-sm font-bold uppercase tracking-[0.14em] text-white"
        >
          <CalendarClock className="size-4" aria-hidden="true" />
          {t("boardTitle")}
        </h2>
        <p className="text-xs text-white/65">{t("boardNote")}</p>
      </div>

      <ol className="mt-2 divide-y divide-white/10">
        {intakes.map((intake, index) => {
          const date = new Date(`${intake.start_date}T00:00:00Z`);
          return (
            <li key={`${intake.slug}-${intake.start_date}-${index}`}>
              <Link
                href={`/${intake.area_slug}/${intake.slug}`}
                // Not prefetched, for the reason given in ProviderCard.
                prefetch={false}
                className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 rounded-lg py-2.5 text-white hover:bg-white/5"
              >
                <time dateTime={intake.start_date} className="flex gap-1">
                  <span className="flap" style={{ animationDelay: `${index * 90}ms` }}>
                    {DAY.format(date)}
                  </span>
                  <span className="flap" style={{ animationDelay: `${index * 90 + 45}ms` }}>
                    {MONTH.format(date)}
                  </span>
                </time>
                <span className="min-w-0">
                  <span className="block truncate text-sm font-semibold">{intake.course}</span>
                  <span className="block truncate text-xs text-white/65">
                    {intake.provider} · {intake.area}
                  </span>
                </span>
                <span className="flex flex-col items-end gap-1 text-right text-xs">
                  <span className={`${tradeClass(intake.trade_colour)} inline-flex items-center gap-1.5 text-white/80`}>
                    <span aria-hidden="true" className="size-2 rounded-full bg-[var(--trade-strong)]" />
                    {intake.trade}
                  </span>
                  <span className="font-semibold text-[var(--color-sand)]">
                    {intake.places_remaining === null
                      ? t("boardOpen")
                      : t("boardPlaces", { count: intake.places_remaining })}
                  </span>
                </span>
              </Link>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
