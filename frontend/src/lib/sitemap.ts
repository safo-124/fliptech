import type { AreaSummary, Region, Trade } from "./types";

export type GeneratedPageCandidate = {
  trade: string;
  place: string;
  scope: "region" | "area";
};

/**
 * Summary requests are deliberately capped. A marketplace can have thousands
 * of trade-and-place combinations, but sitemap generation must not turn that
 * Cartesian product into the same number of simultaneous API requests.
 */
export const SITEMAP_SUMMARY_CONCURRENCY = 8;

/** Yield candidates instead of allocating the complete Cartesian product. */
export function* generatedPageCandidates(
  trades: Pick<Trade, "slug">[],
  regions: Pick<Region, "slug">[],
  areas: Pick<Region["areas"][number], "slug">[],
): Generator<GeneratedPageCandidate> {
  for (const trade of trades) {
    for (const region of regions) {
      yield { trade: trade.slug, place: region.slug, scope: "region" };
    }
  }

  for (const trade of trades) {
    for (const area of areas) {
      yield { trade: trade.slug, place: area.slug, scope: "area" };
    }
  }
}

/**
 * Resolve candidates through a bounded worker pool and retain only pages the
 * API says are safe to index. Results are restored to candidate order so the
 * generated sitemap stays stable even when requests finish out of order.
 */
export async function collectIndexableGeneratedPages(
  candidates: Iterable<GeneratedPageCandidate>,
  loadSummary: (candidate: GeneratedPageCandidate) => Promise<AreaSummary>,
  concurrency = SITEMAP_SUMMARY_CONCURRENCY,
): Promise<GeneratedPageCandidate[]> {
  const requestedWorkers = Number.isFinite(concurrency)
    ? Math.floor(concurrency)
    : SITEMAP_SUMMARY_CONCURRENCY;
  const workerCount = Math.min(
    SITEMAP_SUMMARY_CONCURRENCY,
    Math.max(1, requestedWorkers),
  );
  const iterator = candidates[Symbol.iterator]();
  const indexable: { index: number; candidate: GeneratedPageCandidate }[] = [];
  let nextIndex = 0;

  async function work() {
    while (true) {
      const next = iterator.next();
      if (next.done) return;

      const index = nextIndex++;
      try {
        const summary = await loadSummary(next.value);
        if (summary.has_enough_inventory_to_index) {
          indexable.push({ index, candidate: next.value });
        }
      } catch {
        // One unavailable summary must not prevent the rest of the sitemap
        // from being generated; the uncertain page is safest left unlisted.
      }
    }
  }

  await Promise.all(Array.from({ length: workerCount }, () => work()));

  return indexable
    .sort((left, right) => left.index - right.index)
    .map(({ candidate }) => candidate);
}
