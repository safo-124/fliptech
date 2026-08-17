/**
 * Sitemap for the generated pages.
 *
 * Search traffic is the cheapest demand a marketplace can acquire, and it
 * compounds while paid campaigns do not — so this is not an afterthought.
 *
 * The important rule: a trade-and-place page is listed only when it has real
 * inventory behind it. Six trades across sixteen regions is ninety-six URLs,
 * and with providers in Greater Accra alone, ninety of them would be the thin
 * templates Section 04 warns against. Submitting those is worse than not
 * generating them, because it teaches a crawler the site is mostly empty.
 */

import type { MetadataRoute } from "next";

import { getAreaSummary, getAreas, getRegions, getTrades, searchProviders } from "@/lib/api";

const site = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";

export const revalidate = 3600;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const entries: MetadataRoute.Sitemap = [
    { url: site, changeFrequency: "daily", priority: 1 },
  ];

  const [trades, areas, regions, providers] = await Promise.all([
    getTrades().catch(() => ({ results: [] })),
    getAreas().catch(() => ({ results: [] })),
    getRegions().catch(() => ({ results: [] })),
    searchProviders({}).catch(() => ({ results: [] })),
  ]);

  for (const trade of trades.results) {
    entries.push({
      url: `${site}/trades/${trade.slug}`,
      changeFrequency: "weekly",
      priority: 0.7,
    });
  }

  // Section 04 specifies two scopes: a trade in a region
  // (/greater-accra/welding-training) and a trade in a town (/tema/...).
  // Both share the /<place>/<trade>-training shape, so both are checked here.
  const pairs = [
    ...trades.results.flatMap((trade) =>
      regions.results.map((region) => ({
        trade: trade.slug,
        place: region.slug,
        scope: "region" as const,
      })),
    ),
    ...trades.results.flatMap((trade) =>
      areas.results.map((area) => ({
        trade: trade.slug,
        place: area.slug,
        scope: "area" as const,
      })),
    ),
  ];

  const summaries = await Promise.all(
    pairs.map(async (pair) => ({
      pair,
      summary: await getAreaSummary({
        trade: pair.trade,
        ...(pair.scope === "region" ? { region: pair.place } : { area: pair.place }),
      }).catch(() => null),
    })),
  );

  for (const { pair, summary } of summaries) {
    if (summary?.has_enough_inventory_to_index) {
      entries.push({
        url: `${site}/${pair.place}/${pair.trade}-training`,
        changeFrequency: "weekly",
        // A region page covers more inventory than a town page, so it is the
        // stronger landing target of the two.
        priority: pair.scope === "region" ? 0.8 : 0.7,
      });
    }
  }

  for (const provider of providers.results) {
    entries.push({
      url: `${site}/${provider.area_slug}/${provider.slug}`,
      changeFrequency: "weekly",
      priority: 0.9,
      lastModified: provider.listing_confirmed_on
        ? new Date(provider.listing_confirmed_on)
        : undefined,
    });
  }

  return entries;
}
