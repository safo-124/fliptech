import { describe, expect, it } from "vitest";

import { nameToOffer } from "./name-offer";

describe("nameToOffer", () => {
  it("offers the checked name when the account has another", () => {
    expect(nameToOffer("Emmanuel Acheampong Safo", "Yes", null)).toBe("Emmanuel Acheampong Safo");
    expect(nameToOffer("Ama Mensah", "", null)).toBe("Ama Mensah");
  });

  it("offers nothing until a name has been checked", () => {
    expect(nameToOffer("", "Yes", null)).toBe("");
    expect(nameToOffer(undefined, "Yes", null)).toBe("");
  });

  it("offers nothing when the account already uses it, whatever the spacing or case", () => {
    expect(nameToOffer("Ama  Mensah", " ama mensah ", null)).toBe("");
  });

  it("stops offering a name the person said no to, but offers a new one", () => {
    expect(nameToOffer("Ama Mensah", "Yes", "ama mensah")).toBe("");
    expect(nameToOffer("Ama Owusu", "Yes", "Ama Mensah")).toBe("Ama Owusu");
  });
});
