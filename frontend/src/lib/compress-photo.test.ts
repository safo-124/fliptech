import {describe, expect, it} from "vitest";

import {fitWithin} from "./compress-photo";

describe("fitWithin", () => {
  it("brings the long edge down to 1600 and keeps the shape", () => {
    expect(fitWithin(4000, 3000)).toEqual({width: 1600, height: 1200});
    expect(fitWithin(3000, 4000)).toEqual({width: 1200, height: 1600});
  });

  it("never makes a small photo bigger", () => {
    expect(fitWithin(800, 600)).toEqual({width: 800, height: 600});
  });
});
