import {describe, expect, it} from "vitest";

import {catalogueProblems, coverage, shapeOf, withFallback} from "./catalogue";

const english = {
  Page: {
    title: "Find training",
    count: "{count, plural, one {# workshop} other {# workshops}} near {place}",
    body: "Send it to <strong>{name}</strong>.",
  },
};

describe("an unfinished translation", () => {
  it("shows English wherever it has nothing", () => {
    const merged = withFallback(english, {Page: {title: "Hwehwɛ adesua", body: ""}});

    expect(merged.Page.title).toBe("Hwehwɛ adesua");
    expect(merged.Page.body).toBe(english.Page.body);
    expect(merged.Page.count).toBe(english.Page.count);
  });

  it("drops keys English no longer has", () => {
    expect(withFallback(english, {Old: {gone: "x"}})).not.toHaveProperty("Old");
  });

  it("reports how much is done", () => {
    expect(coverage(english, {Page: {title: "x", body: ""}})).toEqual({done: 1, total: 3});
  });
});

describe("a translation's shape", () => {
  it("is the arguments and tags a message uses", () => {
    expect(shapeOf(english.Page.count)).toEqual(["{count}", "{place}"]);
    expect(shapeOf(english.Page.body)).toEqual(["<strong>", "{name}"]);
  });

  it("must match English, whatever the plural branches say", () => {
    const fine = {
      Page: {
        count: "{count, plural, other {adwumamu #}} wɔ {place}",
        body: "Fa kɔma <strong>{name}</strong>.",
      },
    };
    expect(catalogueProblems(english, fine)).toEqual([]);
  });

  it("is reported when an argument or tag is lost, or a key is stale", () => {
    const broken = {Page: {body: "Fa kɔma {name}.", count: "{num} wɔ {place}"}, Old: {gone: "x"}};

    const problems = catalogueProblems(english, broken);

    expect(problems).toHaveLength(3);
    expect(problems.join("\n")).toMatch(/Page\.body: must use <strong> \{name\}/);
    expect(problems.join("\n")).toMatch(/Page\.count/);
    expect(problems.join("\n")).toMatch(/Old\.gone: not in English/);
  });
});
