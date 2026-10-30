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

import { Video } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";

import { BrandShards } from "@/components/BrandShards";
import { CourseTile } from "@/components/CourseTile";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { getAllTrades, listCourses } from "@/lib/api";
import { BRAND } from "@/lib/brand";

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
                  <CourseTile course={course} />
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
