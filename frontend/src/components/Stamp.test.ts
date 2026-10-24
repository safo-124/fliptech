import {describe, expect, it} from "vitest";

import {initialsOf} from "./Stamp";

describe("a stamp's initials", () => {
  it.each([
    ["Ama Mensah", "A.M."],
    ["kwame  boateng", "K.B."],
    ["Efua Adwoa Ansah Owusu", "E.A.A."],
    ["Kofi", "K."],
    ["", ""],
  ])("%j → %j", (name, initials) => {
    expect(initialsOf(name)).toBe(initials);
  });
});
