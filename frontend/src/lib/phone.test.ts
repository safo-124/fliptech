import {describe, expect, it} from "vitest";

import {ghanaPhoneSchema, stripPhoneSeparators, toGhanaE164} from "./phone";

describe("Ghana phone helpers", () => {
  it("accepts local and E.164 mobile numbers", () => {
    expect(ghanaPhoneSchema.safeParse("0241234567").success).toBe(true);
    expect(ghanaPhoneSchema.safeParse("+233241234567").success).toBe(true);
    expect(ghanaPhoneSchema.safeParse("241234567").success).toBe(false);
  });

  it("accepts the separators people actually type", () => {
    // The form used to reject all of these, which is how most Ghanaians write
    // a number down.
    for (const typed of [
      "024 123 4567",
      "0241-234-567",
      "(024) 123 4567",
      "+233 24 123 4567",
      "024–123–4567", // en dashes, as pasted from a phone contact
    ]) {
      const result = ghanaPhoneSchema.safeParse(typed);
      expect(result.success, `expected ${typed} to be accepted`).toBe(true);
      if (result.success) expect(toGhanaE164(result.data)).toBe("+233241234567");
    }
  });

  it("parses to the stripped value, so what is stored is never the typed spacing", () => {
    const result = ghanaPhoneSchema.safeParse("024 123 4567");
    expect(result.success && result.data).toBe("0241234567");
  });

  it("still rejects a number that is the wrong length once stripped", () => {
    expect(ghanaPhoneSchema.safeParse("024 123 456").success).toBe(false);
    expect(ghanaPhoneSchema.safeParse("024 123 45678").success).toBe(false);
  });

  it("normalizes the local form before it is sent", () => {
    expect(toGhanaE164("024 123 4567")).toBe("+233241234567");
    expect(toGhanaE164("+233241234567")).toBe("+233241234567");
  });

  it("keeps a leading plus and discards every other non-digit", () => {
    expect(stripPhoneSeparators(" +233 (24) 123-4567 ")).toBe("+233241234567");
    expect(stripPhoneSeparators("024.123.4567")).toBe("0241234567");
  });
});
