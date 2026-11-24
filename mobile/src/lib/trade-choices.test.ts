import { categoryChoiceFor } from "./trade-choices";

const choices = [
  { id: 10, name: "Engineering & Technical Trades" },
  { id: 11, name: "Hospitality & Culinary Arts" },
];
const all = [
  ...choices.map((choice) => ({ ...choice, category: { name: choice.name } })),
  { id: 1, name: "Welding", category: { name: "Engineering & Technical Trades" } },
  { id: 2, name: "Pottery", category: null },
];

describe("categoryChoiceFor", () => {
  it("starts a new item in the category of the workshop's trade", () => {
    expect(categoryChoiceFor(choices, all, 1)).toBe(10);
    expect(categoryChoiceFor(choices, all, 11)).toBe(11);
  });

  it("chooses nothing when the trade has no category, or there is no trade", () => {
    expect(categoryChoiceFor(choices, all, 2)).toBeNull();
    expect(categoryChoiceFor(choices, all, null)).toBeNull();
  });
});
