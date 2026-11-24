/**
 * The page for an address that does not exist, or a listing that has gone,
 * inside the site's own header and footer. Never a dead end: a search box,
 * and the two places most people were heading for anyway.
 */

import { GraduationCap, Search, ShoppingBag } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";

import { Button } from "@/components/ui/button";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("NotFound");
  return { title: t("metaTitle"), robots: { index: false } };
}

export default async function NotFound() {
  const t = await getTranslations("NotFound");
  return (
    <div className="app-shell py-12 sm:py-16">
      <div className="mx-auto max-w-xl text-center">
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--color-brand-strong)]">
          {t("eyebrow")}
        </p>
        <h1 className="mt-2 text-3xl font-bold tracking-[-0.03em] sm:text-4xl">{t("title")}</h1>
        <p className="mt-3 text-base leading-7 text-[var(--color-muted-foreground)]">{t("body")}</p>

        <form action="/search" method="get" role="search" className="mt-7 flex gap-2">
          <label htmlFor="not-found-search" className="sr-only">
            {t("searchLabel")}
          </label>
          <div className="relative flex-1">
            <Search
              aria-hidden="true"
              className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[var(--color-muted-foreground)]"
            />
            <input
              id="not-found-search"
              name="q"
              type="search"
              required
              maxLength={100}
              placeholder={t("searchPlaceholder")}
              className="h-12 w-full rounded-xl border border-[var(--color-border)] bg-[var(--color-card)] pl-9 pr-3 text-base outline-none focus:border-[var(--color-brand)]"
            />
          </div>
          <Button type="submit" size="lg" className="h-12">
            {t("searchAction")}
          </Button>
        </form>

        <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:justify-center">
          <Button asChild variant="outline" size="lg">
            <Link href="/training">
              <GraduationCap aria-hidden="true" />
              {t("findTraining")}
            </Link>
          </Button>
          <Button asChild variant="outline" size="lg">
            <Link href="/marketplace">
              <ShoppingBag aria-hidden="true" />
              {t("marketplace")}
            </Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
