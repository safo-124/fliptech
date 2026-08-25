import { ApiError, getAreaSummary } from "./api";
import type { AreaSummary } from "./types";

type SummaryParams = { trade: string; area?: string; region?: string };
type SummaryFetcher = (params: SummaryParams) => Promise<AreaSummary>;

export type GeneratedTradePage = {
  summary: AreaSummary;
  scope: "area" | "region";
};

async function missingAsNull(request: Promise<AreaSummary>): Promise<AreaSummary | null> {
  try {
    return await request;
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return null;
    throw error;
  }
}

/** Resolve the shared /<place>/<trade>-training route to one real public scope. */
export async function loadGeneratedTradePage(
  place: string,
  trade: string,
  fetchSummary: SummaryFetcher = getAreaSummary,
): Promise<GeneratedTradePage | null> {
  const [byArea, byRegion] = await Promise.all([
    missingAsNull(fetchSummary({ trade, area: place })),
    missingAsNull(fetchSummary({ trade, region: place })),
  ]);

  // Region and area slugs share a namespace. Prefer the area defensively for
  // legacy data that predates that validation, without using inventory as a
  // proxy for whether a place exists.
  if (byArea) return { summary: byArea, scope: "area" };
  if (byRegion) return { summary: byRegion, scope: "region" };
  return null;
}
