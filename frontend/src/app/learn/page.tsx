/**
 * Online learning: every workshop's teaching videos, one course per workshop.
 *
 * A Server Component: the search box, sort and filters are a plain GET
 * form and links, so finding a course works with no JavaScript. Nothing
 * here plays: a card shows a still, how many lessons and how long, and the
 * player is one page deeper, where a tap decides whether any data is spent.
 *
 * Only videos staff have watched, from workshops that are live. See
 * backend/providers/learning.py.
 */

import { BookmarkCheck, GraduationCap, Search, Sparkles, Video, WifiOff } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";

import { BrandShards } from "@/components/BrandShards";
import { CourseTile } from "@/components/CourseTile";
import { ContinueLearning } from "@/components/learn/ContinueLearning";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ClientMessages } from "@/i18n/ClientMessages";
import { LEARN_CLIENT_NAMESPACES } from "@/i18n/namespaces";
import { getAllTrades, listCourses, type CourseQuery } from "@/lib/api";
import { BRAND } from "@/lib/brand";

export const revalidate = 300;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Learn");
  return { title: t("metaTitle"), description: t("metaDescription", { brand: BRAND }) };
}

const SORTS = ["", "newest", "popular", "rating", "free"] as const;
const LEVELS = ["beginner", "intermediate", "advanced"] as const;

function one(value: string | string[] | undefined) {
  return typeof value === "string" ? value : undefined;
}

export default async function LearnPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const raw = await searchParams;
  const sortParam = one(raw.sort);
  const query: CourseQuery = {
    trade: one(raw.trade),
    q: one(raw.q)?.slice(0, 80),
    sort: SORTS.includes(sortParam as (typeof SORTS)[number]) && sortParam ? (sortParam as CourseQuery["sort"]) : undefined,
    level: LEVELS.includes(one(raw.level) as (typeof LEVELS)[number]) ? one(raw.level) : undefined,
    price: one(raw.price) === "free" || one(raw.price) === "paid" ? (one(raw.price) as "free" | "paid") : undefined,
  };
  const filtered = Boolean(query.trade || query.q || query.level || query.price);

  const [courses, featured, trades, t] = await Promise.all([
    listCourses(query).catch(() => null),
    filtered || query.sort ? null : listCourses({ featured: "1" }).catch(() => null),
    getAllTrades().catch(() => []),
    getTranslations("Learn"),
  ]);
  const results = courses?.results ?? [];
  const spotlight = featured?.results.slice(0, 3) ?? [];
  const spotlightIds = new Set(spotlight.map((course) => course.id));
  const rest = spotlight.length ? results.filter((course) => !spotlightIds.has(course.id)) : results;

  /** This page's address with one thing changed, for filter links. */
  function withParam(key: keyof CourseQuery, value: string | undefined) {
    const params = new URLSearchParams();
    for (const [name, current] of Object.entries({ ...query, [key]: value })) {
      if (current) params.set(name, String(current));
    }
    const text = params.toString();
    return text ? `/learn?${text}` : "/learn";
  }

  return (
    <div className="pb-14">
      <section className="band relative isolate overflow-hidden">
        <BrandShards className="pointer-events-none absolute -right-8 -top-12 h-[16rem] w-[22rem] opacity-25" />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -bottom-24 -left-16 size-72 rounded-full bg-[var(--color-brand-pink)]/20 blur-3xl"
        />
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

          <form action="/learn" method="get" role="search" className="mt-6 flex max-w-2xl flex-col gap-2 sm:flex-row">
            {query.trade ? <input type="hidden" name="trade" value={query.trade} /> : null}
            <label htmlFor="learn-q" className="sr-only">
              {t("searchLabel")}
            </label>
            <span className="relative flex-1">
              <Search aria-hidden="true" className="pointer-events-none absolute left-4 top-1/2 size-5 -translate-y-1/2 text-[var(--color-muted-foreground)]" />
              <input
                id="learn-q"
                name="q"
                type="search"
                defaultValue={query.q ?? ""}
                placeholder={t("searchPlaceholder")}
                className="h-12 w-full rounded-xl border-0 bg-white pl-12 pr-4 text-[15px] text-[var(--color-foreground)] shadow-lg outline-none ring-2 ring-transparent placeholder:text-[var(--color-muted-foreground)] focus:ring-[var(--color-peach)]"
              />
            </span>
            <label htmlFor="learn-sort" className="sr-only">
              {t("sortLabel")}
            </label>
            <select
              id="learn-sort"
              name="sort"
              defaultValue={query.sort ?? ""}
              className="h-12 rounded-xl border border-white/25 bg-white/10 px-3 text-sm font-semibold text-white backdrop-blur [&>option]:text-[var(--color-foreground)]"
            >
              {SORTS.map((sort) => (
                <option key={sort} value={sort}>
                  {t(`sort.${sort || "recommended"}`)}
                </option>
              ))}
            </select>
            <Button type="submit" variant="warm" size="lg" className="h-12">
              {t("searchAction")}
            </Button>
          </form>

          {trades.length ? (
            <nav aria-label={t("tradeFilter")} className="mt-5 flex flex-wrap gap-2">
              <FilterLink href={withParam("trade", undefined)} active={!query.trade} label={t("allTrades")} />
              {trades.map((option) => (
                <FilterLink
                  key={option.slug}
                  href={withParam("trade", option.slug)}
                  active={query.trade === option.slug}
                  label={option.name}
                />
              ))}
            </nav>
          ) : null}

          <div className="mt-3 flex flex-wrap items-center gap-2" aria-label={t("moreFilters")} role="group">
            {LEVELS.map((level) => (
              <FilterLink
                key={level}
                small
                href={withParam("level", query.level === level ? undefined : level)}
                active={query.level === level}
                label={t(`level.${level}`)}
              />
            ))}
            <span aria-hidden="true" className="mx-1 h-5 w-px bg-white/20" />
            <FilterLink
              small
              href={withParam("price", query.price === "free" ? undefined : "free")}
              active={query.price === "free"}
              label={t("freeOnly")}
            />
            <FilterLink
              small
              href={withParam("price", query.price === "paid" ? undefined : "paid")}
              active={query.price === "paid"}
              label={t("paidOnly")}
            />
          </div>

          <div className="mt-6 flex flex-wrap gap-2 text-sm">
            <Link
              href="/learn/mine"
              className="inline-flex items-center gap-2 rounded-full bg-white/10 px-4 py-2 font-semibold text-white hover:bg-white/20"
            >
              <GraduationCap aria-hidden="true" className="size-4" />
              {t("myCourses")}
            </Link>
            <Link
              href="/learn/saved"
              className="inline-flex items-center gap-2 rounded-full bg-white/10 px-4 py-2 font-semibold text-white hover:bg-white/20"
            >
              <WifiOff aria-hidden="true" className="size-4" />
              {t("savedLessons")}
            </Link>
          </div>
        </div>
      </section>

      {!filtered ? (
        <ClientMessages namespaces={LEARN_CLIENT_NAMESPACES}>
          <ContinueLearning />
        </ClientMessages>
      ) : null}

      {spotlight.length ? (
        <section aria-labelledby="featured-heading" className="app-shell mt-10">
          <h2
            id="featured-heading"
            className="flex items-center gap-2 text-xl font-extrabold tracking-[-0.03em] text-[var(--color-brand-deep)]"
          >
            <Sparkles aria-hidden="true" className="size-5 text-[var(--color-coral)]" />
            {t("featuredTitle")}
          </h2>
          <ul className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {spotlight.map((course) => (
              <li key={course.id}>
                <CourseTile course={course} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="app-shell mt-10">
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
              {filtered ? t("noneMatch") : t("noneYet")}
            </h2>
            <p className="mx-auto mt-2 max-w-[48ch] text-sm leading-relaxed text-[var(--color-muted-foreground)]">
              {filtered ? t("noneMatchBody") : t("noneYetBody", { brand: BRAND })}
            </p>
            {filtered ? (
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
            <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="text-xl font-extrabold tracking-[-0.03em] text-[var(--color-brand-deep)]">
                {query.q ? t("resultsFor", { q: query.q }) : spotlight.length ? t("allCoursesTitle") : t("coursesTitle")}
              </h2>
              <p className="text-sm text-[var(--color-muted-foreground)]">{t("count", { count: courses.count })}</p>
            </div>
            <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {rest.map((course) => (
                <li key={course.id}>
                  <CourseTile course={course} />
                </li>
              ))}
            </ul>
          </>
        )}
        <p className="mt-8 flex items-center gap-2 text-xs text-[var(--color-muted-foreground)]">
          <BookmarkCheck aria-hidden="true" className="size-4" />
          {t("certificateNote")}
        </p>
      </section>
    </div>
  );
}

function FilterLink({
  href,
  active,
  label,
  small = false,
}: {
  href: string;
  active: boolean;
  label: string;
  small?: boolean;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={`rounded-full border border-white/25 font-semibold text-white/85 transition-colors hover:bg-white/10 aria-[current=page]:border-transparent aria-[current=page]:bg-white aria-[current=page]:text-[var(--color-brand-strong)] ${
        small ? "px-3 py-1 text-xs" : "px-3.5 py-1.5 text-sm"
      }`}
    >
      {label}
    </Link>
  );
}
