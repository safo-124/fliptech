import { describe, expect, it } from "vitest";

import { bandFor, bandPrices, isMarketKind, MARKET_KINDS } from "./market-kinds";

describe("market kinds", () => {
  it("has the eight pictures", () => {
    expect(MARKET_KINDS).toHaveLength(8);
    expect(isMarketKind("clothes")).toBe(true);
    expect(isMarketKind("spaceships")).toBe(false);
    expect(isMarketKind(undefined)).toBe(false);
  });
});

describe("price bands", () => {
  it("turns a band into the prices the API reads, and back", () => {
    expect(bandPrices("100-500")).toEqual({ min_price: "100", max_price: "500" });
    expect(bandPrices("0-100")).toEqual({ min_price: undefined, max_price: "100" });
    expect(bandPrices("2000-")).toEqual({ min_price: "2000", max_price: undefined });
    expect(bandPrices("")).toBeNull();
    expect(bandFor("100", "500")).toBe("100-500");
    expect(bandFor(undefined, "100")).toBe("0-100");
    expect(bandFor("150", "500")).toBe("");
  });
});
