import { describe, expect, it } from "vitest";

import {
  collectIndexableGeneratedPages,
  generatedPageCandidates,
  type GeneratedPageCandidate,
} from "./sitemap";
import type { AreaSummary } from "./types";

function summary(indexable: boolean): AreaSummary {
  return {
    provider_count: indexable ? 3 : 0,
    lowest_fee: null,
    highest_fee: null,
    average_fee: null,
    shortest_weeks: null,
    longest_weeks: null,
    has_enough_inventory_to_index: indexable,
    minimum_for_indexing: 3,
  };
}

describe("generatedPageCandidates", () => {
  it("lazily covers every region and area for every trade in stable order", () => {
    const candidates = generatedPageCandidates(
      [{ slug: "welding" }, { slug: "carpentry" }],
      [{ slug: "greater-accra" }, { slug: "ashanti" }],
      [{ slug: "tema" }],
    );

    expect([...candidates]).toEqual([
      { trade: "welding", place: "greater-accra", scope: "region" },
      { trade: "welding", place: "ashanti", scope: "region" },
      { trade: "carpentry", place: "greater-accra", scope: "region" },
      { trade: "carpentry", place: "ashanti", scope: "region" },
      { trade: "welding", place: "tema", scope: "area" },
      { trade: "carpentry", place: "tema", scope: "area" },
    ]);
  });
});

describe("collectIndexableGeneratedPages", () => {
  it("caps active requests, omits failures and preserves candidate order", async () => {
    const candidates: GeneratedPageCandidate[] = Array.from(
      { length: 12 },
      (_, index) => ({
        trade: `trade-${index}`,
        place: `place-${index}`,
        scope: index % 2 === 0 ? "region" : "area",
      }),
    );
    let active = 0;
    let maximumActive = 0;

    const result = await collectIndexableGeneratedPages(
      candidates,
      async (candidate) => {
        active += 1;
        maximumActive = Math.max(maximumActive, active);
        await new Promise((resolve) =>
          setTimeout(resolve, candidate.trade === "trade-0" ? 10 : 1),
        );
        active -= 1;

        if (candidate.trade === "trade-5") throw new Error("Unavailable");
        return summary(Number(candidate.trade.slice(6)) % 2 === 0);
      },
      3,
    );

    expect(maximumActive).toBe(3);
    expect(result.map(({ trade }) => trade)).toEqual([
      "trade-0",
      "trade-2",
      "trade-4",
      "trade-6",
      "trade-8",
      "trade-10",
    ]);
  });
});
