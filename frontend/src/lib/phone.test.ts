import {describe, expect, it} from "vitest";

import {ghanaPhoneSchema, toGhanaE164} from "./phone";

describe("Ghana phone helpers", () => {
  it("accepts local and E.164 mobile numbers", () => {
    expect(ghanaPhoneSchema.safeParse("0241234567").success).toBe(true);
    expect(ghanaPhoneSchema.safeParse("+233241234567").success).toBe(true);
    expect(ghanaPhoneSchema.safeParse("241234567").success).toBe(false);
  });

  it("normalizes the local form before it is sent", () => {
    expect(toGhanaE164("024 123 4567")).toBe("+233241234567");
    expect(toGhanaE164("+233241234567")).toBe("+233241234567");
  });
});
