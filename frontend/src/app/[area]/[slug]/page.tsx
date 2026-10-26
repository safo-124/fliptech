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
import { getTranslations } from "next-intl/server";
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
import { ProfileViewBeacon } from "@/components/ProfileViewBeacon";
import { ProviderProfile } from "@/components/ProviderProfile";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ApiError, getProvider, searchProviders } from "@/lib/api";
import { BRAND } from "@/lib/brand";
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
  const t = await getTranslations("AreaPages");

  if (trade) {
    const loaded = await loadGeneratedTradePage(area, trade);
    const tradeName = titleCase(trade);
    return {
      title: t("tradeTitle", { trade: tradeName, place }),
      description: t("tradeDescription", { trade: tradeName.toLowerCase(), place }),
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
  if (!provider) return { title: t("notFound") };
  const description = t("providerDescription", { name: provider.name, area: provider.area });
  return {
    title: provider.name,
    description,
    alternates: { canonical: `/${area}/${slug}` },
    // What WhatsApp writes under the share card (opengraph-image.tsx beside
    // this file draws the card itself).
    openGraph: {
      title: provider.name,
      description,
      type: "website",
      siteName: `${BRAND} Skills Hub`,
    },
  };
}

export default async function AreaSlugPage({ params }: { params: Promise<Params> }) {
  const { area, slug } = await params;
  const trade = tradeFromSlug(slug);

  if (trade) return <TradeAreaPage area={area} trade={trade} />;

  const t = await getTranslations("AreaPages");
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
      <ProfileViewBeacon providerId={provider.id} />
      <div className="relative overflow-hidden pb-8 sm:pb-12">
        <div
          aria-hidden="true"
          className="surface-grid pointer-events-none absolute inset-x-0 top-0 h-72 opacity-70"
        />
        <div className="app-shell relative pt-3 sm:pt-5">
          <Button asChild variant="ghost" size="sm" className="-ml-2 mb-2">
            <Link href="/training">
              <ArrowLeft aria-hidden="true" />
              {t("backToSearch")}
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
  const [providers, t, tFormat] = await Promise.all([
    searchProviders({
      trade,
      ...(scope === "area" ? { area } : { region: area }),
    }).catch(() => null),
    getTranslations("AreaPages"),
    getTranslations("Format"),
  ]);

  const place = titleCase(area);
  const tradeName = titleCase(trade);
  const hasProviders = summary.provider_count > 0;
  const hasDurations = summary.shortest_weeks !== null && summary.longest_weeks !== null;
  const durationRange = hasDurations
    ? t("weeksRange", { shortest: summary.shortest_weeks!, longest: summary.longest_weeks! })
    : t("notListed");
  const feeRange = formatFeeRange(summary.lowest_fee, summary.highest_fee, tFormat);

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
            {t("allTradeTraining", { trade: tradeName.toLowerCase() })}
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
              {t("guideFor", { place })}
            </Badge>
            <h1 className="max-w-2xl text-3xl font-bold tracking-[-0.035em] sm:text-4xl lg:text-5xl">
              {t("tradeTitle", { trade: tradeName, place })}
            </h1>
            <p className="mt-4 max-w-2xl text-base leading-7 text-[var(--color-muted-foreground)] sm:text-lg">
              {t("tradeLead")}
            </p>
          </div>

          {hasProviders ? (
            <dl className="relative mt-7 grid gap-3 sm:grid-cols-3 lg:max-w-3xl">
              <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-background)]/80 p-4">
                <dt className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.12em] text-[var(--color-muted-foreground)]">
                  <Search className="size-4 text-[var(--color-brand)]" aria-hidden="true" />
                  {t("providers")}
                </dt>
                <dd className="mt-2 text-2xl font-bold tabular-nums">{summary.provider_count}</dd>
              </div>
              <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-background)]/80 p-4">
                <dt className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.12em] text-[var(--color-muted-foreground)]">
                  <WalletCards className="size-4 text-[var(--color-brand)]" aria-hidden="true" />
                  {t("feeRange")}
                </dt>
                <dd className="mt-2 text-lg font-bold">{feeRange}</dd>
              </div>
              <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-background)]/80 p-4">
                <dt className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.12em] text-[var(--color-muted-foreground)]">
                  <Clock3 className="size-4 text-[var(--color-brand)]" aria-hidden="true" />
                  {t("courseLength")}
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
                  {t("localOptions")}
                </p>
                <h2 className="mt-1 text-2xl font-bold tracking-tight">{t("compareProviders")}</h2>
              </div>
              <p className="flex items-center gap-2 text-sm text-[var(--color-muted-foreground)]">
                <ShieldCheck className="size-4 text-[var(--color-visit)]" aria-hidden="true" />
                {t("trustOnEveryListing")}
              </p>
            </div>

            <p className="mt-4 max-w-3xl text-sm leading-6 text-[var(--color-muted-foreground)] sm:text-base sm:leading-7">
              {t("summaryParagraph", {
                count: summary.provider_count,
                trade: tradeName.toLowerCase(),
                place,
                feeRange,
                hasDurations: hasDurations ? "yes" : "no",
                shortest: summary.shortest_weeks ?? 0,
                longest: summary.longest_weeks ?? 0,
              })}
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
                <AlertTitle>{t("unavailableTitle")}</AlertTitle>
                <AlertDescription>{t("unavailableAreaBody")}</AlertDescription>
              </Alert>
            )}
          </>
        ) : (
          <Card className="mx-auto mt-8 max-w-2xl border-dashed text-center sm:mt-10">
            <CardContent className="px-5 py-9 sm:px-10 sm:py-12">
              <div className="mx-auto flex size-12 items-center justify-center rounded-2xl bg-[var(--color-brand-soft)] text-[var(--color-brand-strong)]">
                <MapPin aria-hidden="true" />
              </div>
              <h2 className="mt-4 text-xl font-bold">{t("noLocalTitle")}</h2>
              <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-[var(--color-muted-foreground)]">
                {t("noLocalBody", { trade: tradeName.toLowerCase(), place })}
              </p>
              <Button asChild variant="brand" className="mt-5">
                <Link href={`/?trade=${trade}`}>
                  {t("seeElsewhere")}
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
