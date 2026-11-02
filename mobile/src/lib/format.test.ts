import { cedis, courseLength } from "./format";

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
    expect(courseLength(1, 30)).toBe("1 lesson · 1 min");
    expect(courseLength(5, 249)).toBe("5 lessons · 4 min");
    expect(courseLength(12, 5400)).toBe("12 lessons · 1.5 hours");
  });
});
