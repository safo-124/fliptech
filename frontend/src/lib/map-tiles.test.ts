import {describe, expect, it} from "vitest";

import {DEFAULT_TILE_URL, softTilesClass} from "./map-tiles";

describe("map tiles", () => {
  it("quietens OpenStreetMap's own style, so the pins stand out", () => {
    expect(softTilesClass(DEFAULT_TILE_URL)).toBe("map-soft-tiles");
  });

  it("draws a provider somebody chose as it comes", () => {
    expect(softTilesClass("https://tiles.example.com/light/{z}/{x}/{y}.png")).toBe("");
  });
});
