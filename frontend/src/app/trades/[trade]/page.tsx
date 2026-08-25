/** The trade explainer page: /trades/welding. One per trade. */

import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ArrowLeft,
  ArrowRight,
  BookOpenCheck,
  GraduationCap,
  Search,
  ShieldCheck,
} from "lucide-react";

import { ProviderCard } from "@/components/ProviderCard";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ApiError, getTrade, searchProviders } from "@/lib/api";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ trade: string }>;
}): Promise<Metadata> {
  const { trade } = await params;
  const found = await getTrade(trade).catch(() => null);
  if (!found) return { title: "Not found" };
  return {
    title: `${found.name} training in Ghana`,
    description:
      found.description ||
      `What ${found.name.toLowerCase()} training costs, how long it takes, and where to find it.`,
    alternates: { canonical: `/trades/${trade}` },
  };
}

export default async function TradePage({ params }: { params: Promise<{ trade: string }> }) {
  const { trade } = await params;
  let found;
  try {
    found = await getTrade(trade);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) notFound();
    throw error;
  }

  const results = await searchProviders({ trade }).catch(() => null);

  return (
    <div className="relative overflow-hidden pb-12">
      <div
        aria-hidden="true"
        className="surface-grid pointer-events-none absolute inset-x-0 top-0 h-[30rem] opacity-70"
      />

      <div className="app-shell relative py-4 sm:py-7 lg:py-10">
        <Button asChild variant="ghost" size="sm" className="-ml-2 mb-3">
          <Link href="/">
            <ArrowLeft aria-hidden="true" />
            Search all trades
          </Link>
        </Button>

        <section className="relative overflow-hidden rounded-3xl border border-[var(--color-border)] bg-[var(--color-card)] px-5 py-8 shadow-[var(--shadow-lg)] sm:px-8 sm:py-10 lg:px-12 lg:py-14">
          <div
            aria-hidden="true"
            className="absolute -right-28 -top-32 size-80 rounded-full bg-[var(--color-brand-soft)] blur-3xl"
          />
          <div
            aria-hidden="true"
            className="absolute -bottom-40 right-40 size-72 rounded-full bg-[var(--color-visit-bg)] blur-3xl"
          />

          <div className="relative max-w-3xl">
            <Badge variant="secondary" className="mb-4">
              <BookOpenCheck aria-hidden="true" />
              Trade guide
            </Badge>
            <h1 className="max-w-2xl text-3xl font-bold tracking-[-0.04em] sm:text-4xl lg:text-5xl">
              {found.name} training
            </h1>
            {found.description && (
              <p className="mt-4 max-w-2xl text-base leading-7 text-[var(--color-muted-foreground)] sm:text-lg sm:leading-8">
                {found.description}
              </p>
            )}

            <div className="mt-7 flex flex-wrap items-center gap-3">
              <Badge variant="outline" className="px-3 py-2 text-xs">
                <GraduationCap aria-hidden="true" />
                {found.provider_count} listed{" "}
                {found.provider_count === 1 ? "provider" : "providers"}
              </Badge>
              <span className="inline-flex items-center gap-2 text-xs text-[var(--color-muted-foreground)]">
                <ShieldCheck className="size-4 text-[var(--color-visit)]" aria-hidden="true" />
                Fees, schedules and trust details in one place
              </span>
            </div>
          </div>
        </section>

        <div className="mt-8 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between lg:mt-10">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--color-brand-strong)]">
              Available training
            </p>
            <h2 className="mt-1 text-2xl font-bold tracking-tight">Compare providers</h2>
          </div>
          {results ? (
            <p className="text-sm text-[var(--color-muted-foreground)]">
              Showing {results.results.length} of {results.count}
            </p>
          ) : null}
        </div>

        {results === null ? (
          <Alert variant="warning" className="mt-5">
            <Search aria-hidden="true" />
            <AlertTitle>Listings are temporarily unavailable</AlertTitle>
            <AlertDescription>
              Please try this page again shortly, or return to search to explore other trades.
            </AlertDescription>
          </Alert>
        ) : results.results.length > 0 ? (
          <ul className="mt-6 grid grid-cols-1 items-stretch gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {results.results.map((provider) => (
              <li key={provider.id}>
                <ProviderCard provider={provider} />
              </li>
            ))}
          </ul>
        ) : (
          <Card className="mt-6 border-dashed text-center">
            <CardContent className="px-5 py-10 sm:px-10 sm:py-12">
              <div className="mx-auto flex size-12 items-center justify-center rounded-2xl bg-[var(--color-brand-soft)] text-[var(--color-brand-strong)]">
                <Search aria-hidden="true" />
              </div>
              <h3 className="mt-4 text-xl font-bold">No providers listed yet</h3>
              <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-[var(--color-muted-foreground)]">
                Try another trade or return soon as new training providers are added regularly.
              </p>
            </CardContent>
          </Card>
        )}

        <Button asChild variant="outline" className="mt-8 w-full sm:w-auto">
          <Link href="/">
            Search all trades
            <ArrowRight aria-hidden="true" />
          </Link>
        </Button>
      </div>
    </div>
  );
}
