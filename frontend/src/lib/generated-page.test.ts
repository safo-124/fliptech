import { describe, expect, it, vi } from "vitest";

import { ApiError } from "./api";
import { loadGeneratedTradePage } from "./generated-page";
import type { AreaSummary } from "./types";

function summary(providerCount: number): AreaSummary {
  return {
    provider_count: providerCount,
    lowest_fee: null,
    highest_fee: null,
    average_fee: null,
    shortest_weeks: null,
    longest_weeks: null,
    has_enough_inventory_to_index: providerCount >= 3,
    minimum_for_indexing: 3,
  };
}

describe("loadGeneratedTradePage", () => {
  it("does not resolve a place when neither public scope exists", async () => {
    const fetchSummary = vi.fn(async () => {
      throw new ApiError("Not found", 404);
    });

    await expect(
      loadGeneratedTradePage("ashanti", "welding", fetchSummary),
    ).resolves.toBeNull();
  });

  it("preserves a real area page even when it has no inventory", async () => {
    const emptyArea = summary(0);
    const fetchSummary = vi.fn(async (params: { area?: string; region?: string }) => {
      if (params.area) return emptyArea;
      throw new ApiError("Not found", 404);
    });

    await expect(
      loadGeneratedTradePage("kumasi", "welding", fetchSummary),
    ).resolves.toEqual({ summary: emptyArea, scope: "area" });
  });

  it("resolves a launched region and does not hide upstream failures", async () => {
    const regionSummary = summary(3);
    const fetchSummary = vi.fn(async (params: { area?: string; region?: string }) => {
      if (params.region) return regionSummary;
      throw new ApiError("Not found", 404);
    });

    await expect(
      loadGeneratedTradePage("greater-accra", "welding", fetchSummary),
    ).resolves.toEqual({ summary: regionSummary, scope: "region" });

    const unavailable = vi.fn(async () => {
      throw new ApiError("API 503", 503);
    });
    await expect(
      loadGeneratedTradePage("greater-accra", "welding", unavailable),
    ).rejects.toMatchObject({ status: 503 });
  });
});
