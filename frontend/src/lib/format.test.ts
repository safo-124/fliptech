import {describe, expect, it} from "vitest";

import {formatCedis, withArea} from "./format";

describe("formatCedis", () => {
  it("writes whole cedis without pesewas", () => {
    expect(formatCedis("150.00")).toBe("GH₵150");
  });

  it("never rounds away the pesewas someone will pay", () => {
    expect(formatCedis("149.50")).toBe("GH₵149.50");
  });
});

describe("withArea", () => {
  it("adds the area once", () => {
    expect(withArea("Zongo Junction road", "Madina")).toBe("Zongo Junction road, Madina");
    expect(withArea("Zongo Junction road, Madina", "Madina")).toBe("Zongo Junction road, Madina");
    expect(withArea("Zongo Junction road, madina.", "Madina")).toBe("Zongo Junction road, madina");
    expect(withArea("", "Madina")).toBe("Madina");
    expect(withArea(null, "Madina")).toBe("Madina");
    // A street named after the area is not the area.
    expect(withArea("Madina Market road", "Madina")).toBe("Madina Market road, Madina");
  });
});
