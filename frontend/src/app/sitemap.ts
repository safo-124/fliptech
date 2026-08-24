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
import { connection } from "next/server";

import {
  getAllAreas,
  getAllRegions,
  getAllTrades,
  getAreaSummary,
  searchAllProviders,
} from "@/lib/api";
import {
  collectIndexableGeneratedPages,
  generatedPageCandidates,
} from "@/lib/sitemap";

const site = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";

export const revalidate = 3600;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  // Sitemap inventory belongs to the running API, not the frontend build.
  // Deferring until request time prevents an offline build from caching a
  // home-page-only sitemap for the revalidation window.
  await connection();

  const entries: MetadataRoute.Sitemap = [
    { url: site, changeFrequency: "daily", priority: 1 },
  ];

  const [trades, areas, regions, providers] = await Promise.all([
    getAllTrades().catch(() => []),
    getAllAreas().catch(() => []),
    getAllRegions().catch(() => []),
    searchAllProviders({}).catch(() => []),
  ]);

  for (const trade of trades) {
    entries.push({
      url: `${site}/trades/${trade.slug}`,
      changeFrequency: "weekly",
      priority: 0.7,
    });
  }

  // Section 04 specifies two scopes: a trade in a region
  // (/greater-accra/welding-training) and a trade in a town (/tema/...).
  // Both share the /<place>/<trade>-training shape, so both are checked here.
  const indexablePages = await collectIndexableGeneratedPages(
    generatedPageCandidates(trades, regions, areas),
    (candidate) =>
      getAreaSummary({
        trade: candidate.trade,
        ...(candidate.scope === "region"
          ? { region: candidate.place }
          : { area: candidate.place }),
      }),
  );

  for (const page of indexablePages) {
    entries.push({
      url: `${site}/${page.place}/${page.trade}-training`,
      changeFrequency: "weekly",
      // A region page covers more inventory than a town page, so it is the
      // stronger landing target of the two.
      priority: page.scope === "region" ? 0.8 : 0.7,
    });
  }

  for (const provider of providers) {
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
