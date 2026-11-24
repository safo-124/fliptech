import {describe, expect, it} from "vitest";

import {landmarkTooShort, nameIssue} from "./placeholders";

describe("names and landmarks", () => {
  it("refuses names under 3 letters and filler words", () => {
    expect(nameIssue("Jo")).toBe("short");
    expect(nameIssue("yes")).toBe("filler");
    expect(nameIssue("Test")).toBe("filler");
    expect(nameIssue("aaaa")).toBe("filler");
  });

  it("takes short real names, and says nothing about an empty box", () => {
    expect(nameIssue("Gym")).toBeNull();
    expect(nameIssue("Ama Mensah")).toBeNull();
    expect(nameIssue("")).toBeNull();
  });

  it("wants a landmark in at least two words", () => {
    expect(landmarkTooShort("Mall")).toBe(true);
    expect(landmarkTooShort("Opposite Madina Mall")).toBe(false);
    expect(landmarkTooShort("")).toBe(false);
  });
});
