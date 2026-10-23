import {describe, expect, it} from "vitest";

import {enabledLocales, pickLocale} from "./config";

describe("which languages are switched on", () => {
  it("is English alone unless more are named", () => {
    expect(enabledLocales(undefined)).toEqual(["en"]);
    expect(enabledLocales("")).toEqual(["en"]);
  });

  it("keeps English whatever the setting says, and ignores unknown codes", () => {
    expect(enabledLocales("tw, fr")).toEqual(["en", "tw"]);
    expect(enabledLocales("gaa,tw")).toEqual(["en", "tw", "gaa"]);
  });
});

describe("which language a visitor gets", () => {
  const enabled = ["en", "tw"] as const;

  it("follows the visitor's own choice first", () => {
    expect(pickLocale({cookie: "tw", acceptLanguage: "en-GB", enabled})).toBe("tw");
  });

  it("ignores a choice that is not switched on", () => {
    expect(pickLocale({cookie: "gaa", acceptLanguage: null, enabled})).toBe("en");
  });

  it("then the browser's preference, best first", () => {
    expect(pickLocale({acceptLanguage: "fr;q=0.9, tw-GH;q=0.8, en;q=0.5", enabled})).toBe("tw");
  });

  it("reads Akan as Twi", () => {
    expect(pickLocale({acceptLanguage: "ak-GH,ak;q=0.9", enabled})).toBe("tw");
  });

  it("falls back to English", () => {
    expect(pickLocale({acceptLanguage: "fr-FR", enabled})).toBe("en");
    expect(pickLocale({enabled})).toBe("en");
  });
});
