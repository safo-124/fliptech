import { cedis, courseLength, withArea } from "./format";

describe("cedis", () => {
  it("drops pesewas from whole amounts and keeps them otherwise", () => {
    expect(cedis("150.00")).toBe("GH₵150");
    expect(cedis("79.2")).toBe("GH₵79.20");
    expect(cedis(2400)).toBe("GH₵2,400");
  });

  it("says nothing for a missing price", () => {
    expect(cedis(null)).toBe("");
    expect(cedis("")).toBe("");
    expect(cedis("abc")).toBe("");
  });
});

describe("courseLength", () => {
  it("counts lessons and minutes, or hours past one", () => {
    expect(courseLength(1, 30)).toBe("1 lesson · 30 sec");
    expect(courseLength(1, 60)).toBe("1 lesson · 1 min");
    expect(courseLength(2, 3600)).toBe("2 lessons · 1 hour");
    expect(courseLength(5, 249)).toBe("5 lessons · 4 min");
    expect(courseLength(12, 5400)).toBe("12 lessons · 1.5 hours");
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
