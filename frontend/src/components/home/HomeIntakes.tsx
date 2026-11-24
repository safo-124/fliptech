import {ArrowRight} from "lucide-react";
import Link from "next/link";
import {getTranslations} from "next-intl/server";

import {notPast} from "@/lib/format";
import {tradeClass} from "@/lib/trades";
import type {UpcomingIntake} from "@/lib/types";

const DAY = new Intl.DateTimeFormat("en-GH", {day: "2-digit", timeZone: "UTC"});
const MONTH = new Intl.DateTimeFormat("en-GH", {month: "short", timeZone: "UTC"});

/**
 * "Starting soon" on the home page: one card per course with places, the date
 * first, in a row that swipes on a phone. The search page keeps its own
 * departures board (IntakesBoard); this is the calmer version for the front
 * door, on the page's own background rather than a dark band.
 */
export async function HomeIntakes({intakes: given}: {intakes: UpcomingIntake[]}) {
  const intakes = given.filter((intake) => notPast(intake.start_date));
  if (intakes.length === 0) return null;
  const t = await getTranslations("SearchPage");
  const tHome = await getTranslations("LandingPage");

  return (
    <section aria-labelledby="home-intakes" className="app-shell mt-14 sm:mt-16">
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-1">
        <div>
          <h2 id="home-intakes" className="text-xl font-semibold tracking-[-0.02em] text-[var(--color-brand-deep)] sm:text-2xl">
            {t("boardTitle")}
          </h2>
          <p className="mt-1 text-sm text-[var(--color-muted-foreground)]">{tHome("intakesBody")}</p>
        </div>
        <Link
          href="/training"
          className="inline-flex items-center gap-1 text-[13px] font-semibold text-[var(--color-brand)] hover:underline"
        >
          {tHome("intakesAll")}
          <ArrowRight aria-hidden="true" className="size-3.5" />
        </Link>
      </div>
      <ol className="-mx-3 mt-5 grid snap-x snap-mandatory auto-cols-[84%] grid-flow-col gap-3 overflow-x-auto scroll-px-3 px-3 pb-2 [scrollbar-width:none] sm:auto-cols-[48%] md:mx-0 md:auto-cols-fr md:grid-flow-row md:grid-cols-3 md:px-0 [&::-webkit-scrollbar]:hidden">
        {intakes.map((intake, index) => {
          const date = new Date(`${intake.start_date}T00:00:00Z`);
          return (
            <li key={`${intake.slug}-${intake.start_date}-${index}`} className="snap-start">
              <Link
                href={`/${intake.area_slug}/${intake.slug}`}
                prefetch={false}
                className="flex h-full flex-col gap-4 rounded-xl border border-[var(--color-border)] bg-[var(--color-card)] p-4 transition-colors hover:border-[var(--color-border-strong)]"
              >
                <span className="flex items-start gap-3">
                  <time
                    dateTime={intake.start_date}
                    className="grid w-12 shrink-0 overflow-hidden rounded-lg border border-[var(--color-border)] bg-[var(--color-muted)] text-center leading-none"
                  >
                    <span className="pt-1.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--color-muted-foreground)]">
                      {MONTH.format(date)}
                    </span>
                    <span className="pt-1 pb-1.5 text-lg font-semibold tabular-nums">{DAY.format(date)}</span>
                  </time>
                  <span className="min-w-0">
                    <span className="block truncate text-[15px] font-semibold">{intake.course}</span>
                    <span className="block truncate text-[13px] text-[var(--color-muted-foreground)]">
                      {intake.provider} · {intake.area}
                    </span>
                  </span>
                </span>
                <span className="mt-auto flex items-center justify-between gap-3 text-[13px]">
                  <span className={`${tradeClass(intake.trade_colour)} inline-flex items-center gap-1.5 text-[var(--color-muted-foreground)]`}>
                    <span aria-hidden="true" className="size-2 rounded-full bg-[var(--trade-strong)]" />
                    {intake.trade}
                  </span>
                  <span className="font-semibold text-[var(--color-foreground)]">
                    {intake.places_remaining === null
                      ? t("boardOpen")
                      : t("boardPlaces", {count: intake.places_remaining})}
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
