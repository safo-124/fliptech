import {describe, expect, it} from "vitest";

import {areaOptions, tradeOptions} from "./picker-options";

const regions = [
  {
    name: "Greater Accra",
    areas: [
      {slug: "tema", name: "Tema", provider_count: 3},
      {slug: "adenta", name: "Adenta", provider_count: 0},
    ],
  },
  {name: "Ashanti", areas: [{slug: "kumasi", name: "Kumasi", provider_count: 1}]},
];

describe("areaOptions", () => {
  it("groups areas under their regions, both in alphabetical order", () => {
    expect(areaOptions(regions).map((option) => [option.group, option.label])).toEqual([
      ["Ashanti", "Kumasi"],
      ["Greater Accra", "Adenta"],
      ["Greater Accra", "Tema"],
    ]);
  });

  it("can keep only places with a workshop, with a count beside each", () => {
    const options = areaOptions(regions, {onlyWithWorkshops: true, countLabel: (count) => `${count} workshops`});
    expect(options.map((option) => option.value)).toEqual(["kumasi", "tema"]);
    expect(options[1].hint).toBe("3 workshops");
  });
});

describe("tradeOptions", () => {
  it("keeps each category's trades together, uncategorised ones first", () => {
    const options = tradeOptions([
      {slug: "welding", name: "Welding", category: {name: "Engineering"}},
      {slug: "tailoring", name: "Tailoring", category: {name: "Fashion"}},
      {slug: "pottery", name: "Pottery", category: null},
      {slug: "plumbing", name: "Plumbing", category: {name: "Engineering"}},
    ]);
    expect(options.map((option) => option.value)).toEqual(["pottery", "welding", "plumbing", "tailoring"]);
    expect(options[1].group).toBe("Engineering");
  });

  it("leaves trades ungrouped when none has a category", () => {
    expect(tradeOptions([{slug: "welding", name: "Welding"}])[0].group).toBeUndefined();
  });
});
