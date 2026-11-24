import { describe, expect, it } from "vitest";

import { categoryChoiceFor, choicesWith } from "./trade-choices";

const choices = [
  { id: 10, name: "Engineering & Technical Trades", slug: "engineering", category: { name: "Engineering & Technical Trades" } },
  { id: 11, name: "Hospitality & Culinary Arts", slug: "hospitality", category: { name: "Hospitality & Culinary Arts" } },
];
const all = [...choices, { id: 1, name: "Welding", slug: "welding", category: { name: "Engineering & Technical Trades" } }];

describe("choicesWith", () => {
  it("offers the categories, without grouping them under themselves", () => {
    expect(choicesWith(choices, all)).toEqual([
      { id: 10, name: "Engineering & Technical Trades", slug: "engineering" },
      { id: 11, name: "Hospitality & Culinary Arts", slug: "hospitality" },
    ]);
  });

  it("keeps an older listing's own trade, first, so saving does not change it", () => {
    expect(choicesWith(choices, all, 1).map((choice) => choice.name)).toEqual([
      "Welding",
      "Engineering & Technical Trades",
      "Hospitality & Culinary Arts",
    ]);
    expect(choicesWith(choices, all, "1")[0].id).toBe(1);
  });

  it("adds nothing for a category, “other” or nothing chosen", () => {
    expect(choicesWith(choices, all, 10)).toHaveLength(2);
    expect(choicesWith(choices, all, "other")).toHaveLength(2);
    expect(choicesWith(choices, all, null)).toHaveLength(2);
  });
});

describe("categoryChoiceFor", () => {
  it("starts a new listing in the category of the workshop's trade", () => {
    expect(categoryChoiceFor(choices, all, 1)).toBe(10);
    expect(categoryChoiceFor(choices, all, 11)).toBe(11);
    expect(categoryChoiceFor(choices, all, null)).toBeNull();
    expect(categoryChoiceFor(choices, [{ id: 2, name: "Pottery", slug: "pottery", category: null }], 2)).toBeNull();
  });
});
