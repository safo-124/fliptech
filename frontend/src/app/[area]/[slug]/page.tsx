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

import { ProviderCard } from "@/components/ProviderCard";
import { ProviderProfile } from "@/components/ProviderProfile";
import { ApiError, getAreaSummary, getProvider, searchProviders } from "@/lib/api";
import { formatFeeRange, titleCase } from "@/lib/format";

const TRADE_PAGE_SUFFIX = "-training";

type Params = { area: string; slug: string };

function tradeFromSlug(slug: string): string | null {
  return slug.endsWith(TRADE_PAGE_SUFFIX) ? slug.slice(0, -TRADE_PAGE_SUFFIX.length) : null;
}

async function loadTradePage(area: string, trade: string) {
  // The leading segment may be a region or an area; ask for both and keep
  // whichever returns inventory.
  const [byArea, byRegion] = await Promise.all([
    getAreaSummary({ trade, area }).catch(() => null),
    getAreaSummary({ trade, region: area }).catch(() => null),
  ]);
  if (byArea && byArea.provider_count > 0) return { summary: byArea, scope: "area" as const };
  if (byRegion && byRegion.provider_count > 0) return { summary: byRegion, scope: "region" as const };
  return byArea ? { summary: byArea, scope: "area" as const } : null;
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
    const loaded = await loadTradePage(area, trade);
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
      <ProviderProfile provider={provider} />
    </>
  );
}

async function TradeAreaPage({ area, trade }: { area: string; trade: string }) {
  const loaded = await loadTradePage(area, trade);
  if (!loaded) notFound();

  const { summary, scope } = loaded;
  const providers = await searchProviders({
    trade,
    ...(scope === "area" ? { area } : { region: area }),
  }).catch(() => null);

  const place = titleCase(area);
  const tradeName = titleCase(trade);

  return (
    <div className="px-3 py-4 lg:px-6 lg:py-8">
      <h1 className="text-xl font-bold lg:text-3xl">
        {tradeName} training in {place}
      </h1>

      {summary.provider_count > 0 ? (
        <>
          {/*
            The fee-range paragraph is computed from the listings, not written
            once and left. Section 04 names it as the example of a page that is
            genuinely useful rather than a template with a place name in it.
          */}
          <p className="mt-3 max-w-prose text-sm leading-relaxed lg:text-base">
            There {summary.provider_count === 1 ? "is" : "are"} {summary.provider_count}{" "}
            {tradeName.toLowerCase()}{" "}
            {summary.provider_count === 1 ? "provider" : "providers"} listed in {place}. Fees run
            from{" "}
            {formatFeeRange(summary.lowest_fee, summary.highest_fee)}, and courses last between{" "}
            {summary.shortest_weeks} and {summary.longest_weeks} weeks. Every listing shows the
            fee, the duration and the next intake date, so you can compare before you call.
          </p>

          <ul className="mt-4 grid grid-cols-1 items-stretch gap-3 sm:grid-cols-2 lg:grid-cols-3 lg:gap-4 xl:grid-cols-4">
            {providers?.results.map((provider) => (
              <li key={provider.id}>
                <ProviderCard provider={provider} />
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p className="mt-3 max-w-prose card p-4 text-sm">
          No {tradeName.toLowerCase()} providers are listed in {place} yet.{" "}
          <Link href={`/?trade=${trade}`} className="underline">
            See {tradeName.toLowerCase()} providers elsewhere
          </Link>
          .
        </p>
      )}
    </div>
  );
}
