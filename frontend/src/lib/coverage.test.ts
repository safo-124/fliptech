import {describe, expect, it} from "vitest";

import {COUNTRY, coveragePhrase, coverageSuffix} from "./coverage";

describe("coveragePhrase", () => {
  it("falls back to the country before anything has launched", () => {
    expect(coveragePhrase([])).toBe(COUNTRY);
  });

  it("names a single region, because it is concrete", () => {
    expect(coveragePhrase(["Greater Accra"])).toBe("Greater Accra");
  });

  it("joins two with and", () => {
    expect(coveragePhrase(["Greater Accra", "Ashanti"])).toBe("Greater Accra and Ashanti");
  });

  it("uses a list for three", () => {
    expect(coveragePhrase(["Greater Accra", "Ashanti", "Northern"])).toBe(
      "Greater Accra, Ashanti and Northern",
    );
  });

  it("gives up and says the country past three", () => {
    expect(coveragePhrase(["Greater Accra", "Ashanti", "Northern", "Western"])).toBe(COUNTRY);
  });

  it("ignores blank names rather than rendering a stray comma", () => {
    expect(coveragePhrase(["Greater Accra", "  ", ""])).toBe("Greater Accra");
  });
});

describe("coverageSuffix", () => {
  it("names the region when there is one to name", () => {
    expect(coverageSuffix(["Greater Accra"])).toBe("in Greater Accra");
  });

  it("does not say the country twice in one sentence", () => {
    // "Training in Ghana, in Ghana" is what the naive version produces.
    expect(coverageSuffix([])).toBe(`across ${COUNTRY}`);
    expect(coverageSuffix(["A", "B", "C", "D"])).toBe(`across ${COUNTRY}`);
  });
});
