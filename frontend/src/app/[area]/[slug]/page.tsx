/**
 * Two public page types share one URL shape, so one route resolves both.
 *
 * Section 04 specifies /tema/welding-training (a trade in a town) and
 * /tema/tema-community-1-welding-works (a provider). Both are /<area>/<slug>,
 * which Next cannot disambiguate on its own. The convention adopted here is
 * that a generated trade page always ends in "-training" and the leading
 * segment may be a region or an area; anything else is looked up as a provider.
 *
 * This is why Area and Region slugs share a namespace and why Area.clean()
 * rejects a slug that collides with a region — see DATA_MODEL.md.
 */

import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ArrowLeft,
  ArrowRight,
  Clock3,
  MapPin,
  Search,
  ShieldCheck,
  WalletCards,
} from "lucide-react";

import { ProviderCard } from "@/components/ProviderCard";
import { ProviderProfile } from "@/components/ProviderProfile";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ApiError, getProvider, searchProviders } from "@/lib/api";
import { formatFeeRange, titleCase } from "@/lib/format";
import { loadGeneratedTradePage } from "@/lib/generated-page";

const TRADE_PAGE_SUFFIX = "-training";

type Params = { area: string; slug: string };

function tradeFromSlug(slug: string): string | null {
  return slug.endsWith(TRADE_PAGE_SUFFIX) ? slug.slice(0, -TRADE_PAGE_SUFFIX.length) : null;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<Params>;
}): Promise<Metadata> {
  const { area, slug } = await params;
  const trade = tradeFromSlug(slug);
  const place = titleCase(area);

  if (trade) {
    const loaded = await loadGeneratedTradePage(area, trade);
    const tradeName = titleCase(trade);
    return {
      title: `${tradeName} training in ${place}`,
      description: `Compare ${tradeName.toLowerCase()} training providers in ${place}: fees, duration and start dates.`,
      // Section 04 warns against thin templates with a place name swapped in.
      // A page with no inventory behind it is excluded from the index rather
      // than published and hoped for.
      robots: loaded?.summary.has_enough_inventory_to_index
        ? undefined
        : { index: false, follow: true },
      alternates: { canonical: `/${area}/${slug}` },
    };
  }

  const provider = await getProvider(area, slug).catch(() => null);
  if (!provider) return { title: "Not found" };
  return {
    title: provider.name,
    description: `${provider.name} in ${provider.area}. Fees, duration and intake dates for training courses.`,
    alternates: { canonical: `/${area}/${slug}` },
  };
}

export default async function AreaSlugPage({ params }: { params: Promise<Params> }) {
  const { area, slug } = await params;
  const trade = tradeFromSlug(slug);

  if (trade) return <TradeAreaPage area={area} trade={trade} />;

  let provider;
  try {
    provider = await getProvider(area, slug);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) notFound();
    throw error;
  }

  // Structured data so the profile can appear as a rich result. Search traffic
  // is the cheapest demand a marketplace can acquire.
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "EducationalOrganization",
    name: provider.name,
    address: { "@type": "PostalAddress", streetAddress: provider.address, addressLocality: provider.area, addressCountry: "GH" },
    telephone: provider.contact_phone,
    hasCourse: provider.programmes.map((programme) => ({
      "@type": "Course",
      name: programme.title,
      offers: { "@type": "Offer", price: programme.fee, priceCurrency: "GHS" },
    })),
  };

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <div className="relative overflow-hidden pb-8 sm:pb-12">
        <div
          aria-hidden="true"
          className="surface-grid pointer-events-none absolute inset-x-0 top-0 h-72 opacity-70"
        />
        <div className="app-shell relative pt-3 sm:pt-5">
          <Button asChild variant="ghost" size="sm" className="-ml-2 mb-2">
            <Link href="/">
              <ArrowLeft aria-hidden="true" />
              Back to training search
            </Link>
          </Button>

          <div className="overflow-hidden rounded-2xl border border-[var(--color-border)] bg-[var(--color-card)] shadow-[var(--shadow-lg)] lg:rounded-3xl [&>article>img]:rounded-none">
            <ProviderProfile provider={provider} />
          </div>
        </div>
      </div>
    </>
  );
}

async function TradeAreaPage({ area, trade }: { area: string; trade: string }) {
  const loaded = await loadGeneratedTradePage(area, trade);
  if (!loaded) notFound();

  const { summary, scope } = loaded;
  const providers = await searchProviders({
    trade,
    ...(scope === "area" ? { area } : { region: area }),
  }).catch(() => null);

  const place = titleCase(area);
  const tradeName = titleCase(trade);
  const hasProviders = summary.provider_count > 0;
  const durationRange =
    summary.shortest_weeks !== null && summary.longest_weeks !== null
      ? `${summary.shortest_weeks}–${summary.longest_weeks} weeks`
      : "Not listed";

  return (
    <div className="relative overflow-hidden pb-12">
      <div
        aria-hidden="true"
        className="surface-grid pointer-events-none absolute inset-x-0 top-0 h-[28rem] opacity-70"
      />

      <div className="app-shell relative py-4 sm:py-7 lg:py-10">
        <Button asChild variant="ghost" size="sm" className="-ml-2 mb-3">
          <Link href={`/?trade=${trade}`}>
            <ArrowLeft aria-hidden="true" />
            All {tradeName.toLowerCase()} training
          </Link>
        </Button>

        <section className="relative overflow-hidden rounded-3xl border border-[var(--color-border)] bg-[var(--color-card)] px-5 py-7 shadow-[var(--shadow-lg)] sm:px-8 sm:py-10 lg:px-12 lg:py-12">
          <div
            aria-hidden="true"
            className="absolute -right-24 -top-28 size-72 rounded-full bg-[var(--color-brand-soft)] blur-3xl"
          />
          <div className="relative max-w-3xl">
            <Badge variant="secondary" className="mb-4">
              <MapPin aria-hidden="true" />
              Training guide for {place}
            </Badge>
            <h1 className="max-w-2xl text-3xl font-bold tracking-[-0.035em] sm:text-4xl lg:text-5xl">
              {tradeName} training in {place}
            </h1>
            <p className="mt-4 max-w-2xl text-base leading-7 text-[var(--color-muted-foreground)] sm:text-lg">
              Compare real fees, course lengths and upcoming start dates from local training
              providers before you make contact.
            </p>
          </div>

          {hasProviders ? (
            <dl className="relative mt-7 grid gap-3 sm:grid-cols-3 lg:max-w-3xl">
              <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-background)]/80 p-4">
                <dt className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.12em] text-[var(--color-muted-foreground)]">
                  <Search className="size-4 text-[var(--color-brand)]" aria-hidden="true" />
                  Providers
                </dt>
                <dd className="mt-2 text-2xl font-bold tabular-nums">{summary.provider_count}</dd>
              </div>
              <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-background)]/80 p-4">
                <dt className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.12em] text-[var(--color-muted-foreground)]">
                  <WalletCards className="size-4 text-[var(--color-brand)]" aria-hidden="true" />
                  Fee range
                </dt>
                <dd className="mt-2 text-lg font-bold">
                  {formatFeeRange(summary.lowest_fee, summary.highest_fee)}
                </dd>
              </div>
              <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-background)]/80 p-4">
                <dt className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.12em] text-[var(--color-muted-foreground)]">
                  <Clock3 className="size-4 text-[var(--color-brand)]" aria-hidden="true" />
                  Course length
                </dt>
                <dd className="mt-2 text-lg font-bold">{durationRange}</dd>
              </div>
            </dl>
          ) : null}
        </section>

        {hasProviders ? (
          <>
            {/*
              The fee-range paragraph is computed from the listings, not written
              once and left. Section 04 names it as the example of a page that is
              genuinely useful rather than a template with a place name in it.
            */}
            <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between lg:mt-10">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--color-brand-strong)]">
                  Local options
                </p>
                <h2 className="mt-1 text-2xl font-bold tracking-tight">Compare providers</h2>
              </div>
              <p className="flex items-center gap-2 text-sm text-[var(--color-muted-foreground)]">
                <ShieldCheck className="size-4 text-[var(--color-visit)]" aria-hidden="true" />
                Trust information is shown on every listing
              </p>
            </div>

            <p className="mt-4 max-w-3xl text-sm leading-6 text-[var(--color-muted-foreground)] sm:text-base sm:leading-7">
              There {summary.provider_count === 1 ? "is" : "are"} {summary.provider_count}{" "}
              {tradeName.toLowerCase()} {summary.provider_count === 1 ? "provider" : "providers"}{" "}
              listed in {place}. Fees run from{" "}
              {formatFeeRange(summary.lowest_fee, summary.highest_fee)}
              {summary.shortest_weeks !== null && summary.longest_weeks !== null
                ? `, and courses last between ${summary.shortest_weeks} and ${summary.longest_weeks} weeks`
                : ""}
              . Every listing shows the fee, the duration and the next intake date, so you can
              compare before you call.
            </p>

            {providers ? (
              <ul className="mt-6 grid grid-cols-1 items-stretch gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {providers.results.map((provider) => (
                  <li key={provider.id}>
                    <ProviderCard provider={provider} />
                  </li>
                ))}
              </ul>
            ) : (
              <Alert variant="warning" className="mt-5">
                <Search aria-hidden="true" />
                <AlertTitle>Listings are temporarily unavailable</AlertTitle>
                <AlertDescription>
                  Please try this page again shortly, or widen your search to another area.
                </AlertDescription>
              </Alert>
            )}
          </>
        ) : (
          <Card className="mx-auto mt-8 max-w-2xl border-dashed text-center sm:mt-10">
            <CardContent className="px-5 py-9 sm:px-10 sm:py-12">
              <div className="mx-auto flex size-12 items-center justify-center rounded-2xl bg-[var(--color-brand-soft)] text-[var(--color-brand-strong)]">
                <MapPin aria-hidden="true" />
              </div>
              <h2 className="mt-4 text-xl font-bold">No local listings yet</h2>
              <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-[var(--color-muted-foreground)]">
                No {tradeName.toLowerCase()} providers are listed in {place} yet. Widen your
                search to compare training options in other areas.
              </p>
              <Button asChild variant="brand" className="mt-5">
                <Link href={`/?trade=${trade}`}>
                  See providers elsewhere
                  <ArrowRight aria-hidden="true" />
                </Link>
              </Button>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
