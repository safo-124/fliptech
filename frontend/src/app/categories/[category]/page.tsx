/**
 * A category page: /categories/fashion-beauty-leather. Its trades, then the
 * workshops, online courses and shop items in them, each with a way to see
 * the rest in the list it comes from. A category with nothing live yet still
 * opens (a shared link should not break), saying so plainly.
 */

import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { ArrowLeft, ArrowRight } from "lucide-react";

import { CategoryIcon } from "@/components/CategoryIcon";
import { CourseTile } from "@/components/CourseTile";
import { ProviderCard } from "@/components/ProviderCard";
import { ProductTile } from "@/components/marketplace/ProductTile";
import { Button } from "@/components/ui/button";
import { ApiError, getTradeCategory, listCourses, searchProducts, searchProviders } from "@/lib/api";
import { tradeClass } from "@/lib/trades";

/** How many of each to show here; "See all" opens the rest. */
const SHOWN = 6;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ category: string }>;
}): Promise<Metadata> {
  const { category } = await params;
  const [found, t] = await Promise.all([
    getTradeCategory(category).catch(() => null),
    getTranslations("CategoryPage"),
  ]);
  if (!found) return { title: t("notFound") };
  return {
    title: t("metaTitle", { category: found.name }),
    description: found.description || t("metaDescription", { category: found.name }),
    alternates: { canonical: `/categories/${category}` },
  };
}

export default async function CategoryPage({ params }: { params: Promise<{ category: string }> }) {
  const { category } = await params;
  let found;
  try {
    found = await getTradeCategory(category);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) notFound();
    throw error;
  }

  const [workshops, courses, products, t] = await Promise.all([
    found.provider_count ? searchProviders({ category }).catch(() => null) : null,
    found.course_count ? listCourses({ category }).catch(() => null) : null,
    found.product_count ? searchProducts({ category }).catch(() => null) : null,
    getTranslations("CategoryPage"),
  ]);
  const liveTrades = found.trades.filter((trade) => trade.provider_count > 0);

  return (
    <div className="relative overflow-hidden pb-12">
      <div
        aria-hidden="true"
        className="surface-grid pointer-events-none absolute inset-x-0 top-0 h-[30rem] opacity-70"
      />

      <div className="app-shell relative py-4 sm:py-7 lg:py-10">
        <Button asChild variant="ghost" size="sm" className="-ml-2 mb-3">
          <Link href="/#categories">
            <ArrowLeft aria-hidden="true" />
            {t("allCategories")}
          </Link>
        </Button>

        <section className="relative overflow-hidden rounded-3xl border border-[var(--color-border)] bg-[var(--color-card)] px-5 py-8 shadow-[var(--shadow-lg)] sm:px-8 sm:py-10 lg:px-12 lg:py-12">
          <div
            aria-hidden="true"
            className="absolute -right-28 -top-32 size-80 rounded-full bg-[var(--color-brand-soft)] blur-3xl"
          />
          <div className="relative flex flex-col gap-5 sm:flex-row sm:items-start">
            <span className="grid size-16 shrink-0 place-items-center rounded-2xl bg-[var(--color-brand-soft)] text-[var(--color-brand-strong)] sm:size-20">
              <CategoryIcon icon={found.icon} className="size-8 sm:size-10" />
            </span>
            <div className="max-w-3xl">
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--color-brand-strong)]">
                {t("eyebrow")}
              </p>
              <h1 className="mt-1 text-3xl font-bold tracking-[-0.04em] sm:text-4xl">{found.name}</h1>
              {found.description ? (
                <p className="mt-3 text-base leading-7 text-[var(--color-muted-foreground)] sm:text-lg">
                  {found.description}
                </p>
              ) : null}
              <p className="mt-4 flex flex-wrap gap-x-4 gap-y-1 text-sm font-semibold text-[var(--color-muted-foreground)]">
                <span>{t("workshops", { count: found.provider_count })}</span>
                <span>{t("courses", { count: found.course_count })}</span>
                <span>{t("products", { count: found.product_count })}</span>
              </p>
            </div>
          </div>
        </section>

        {liveTrades.length ? (
          <section className="mt-8" aria-labelledby="category-trades">
            <h2 id="category-trades" className="text-lg font-bold">
              {t("tradesTitle")}
            </h2>
            <ul className="mt-3 flex flex-wrap gap-2">
              {liveTrades.map((trade) => (
                <li key={trade.slug}>
                  <Link
                    href={`/training?trade=${trade.slug}`}
                    className={`${tradeClass(trade.colour)} inline-flex min-h-11 items-center gap-2 rounded-full border border-[var(--color-border)] bg-[var(--trade-bg)] px-4 text-sm font-semibold text-[var(--trade-fg)] hover:border-[var(--trade-strong)]`}
                  >
                    {trade.name}
                    <span className="text-xs font-normal opacity-80">{trade.provider_count}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {!found.live ? (
          <div className="mt-8 rounded-2xl border border-dashed border-[var(--color-border-strong)] p-8 text-center">
            <h2 className="text-lg font-bold">{t("emptyTitle")}</h2>
            <p className="mx-auto mt-2 max-w-md text-sm text-[var(--color-muted-foreground)]">{t("emptyBody")}</p>
          </div>
        ) : null}

        {workshops?.results.length ? (
          <Section title={t("trainingTitle")} href={`/training?category=${category}`} more={t("seeAll")}>
            <ul className="grid grid-cols-1 items-stretch gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {workshops.results.slice(0, SHOWN).map((provider) => (
                <li key={provider.id}>
                  <ProviderCard provider={provider} />
                </li>
              ))}
            </ul>
          </Section>
        ) : null}

        {courses?.results.length ? (
          <Section title={t("coursesTitle")} href={`/learn?category=${category}`} more={t("seeAll")}>
            <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
              {courses.results.slice(0, SHOWN).map((course) => (
                <li key={course.id}>
                  <CourseTile course={course} />
                </li>
              ))}
            </ul>
          </Section>
        ) : null}

        {products?.results.length ? (
          <Section title={t("shopTitle")} href={`/marketplace?category=${category}`} more={t("seeAll")}>
            <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
              {products.results.slice(0, SHOWN).map((product) => (
                <li key={product.id}>
                  <ProductTile product={product} />
                </li>
              ))}
            </ul>
          </Section>
        ) : null}
      </div>
    </div>
  );
}

function Section({
  title,
  href,
  more,
  children,
}: {
  title: string;
  href: string;
  more: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-10">
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-xl font-extrabold tracking-[-0.03em] text-[var(--color-brand-deep)] sm:text-2xl">
          {title}
        </h2>
        <Link
          href={href}
          className="inline-flex items-center gap-1 text-[13px] font-bold text-[var(--color-brand)] hover:underline"
        >
          {more}
          <ArrowRight aria-hidden="true" className="size-3.5" />
        </Link>
      </div>
      {children}
    </section>
  );
}
