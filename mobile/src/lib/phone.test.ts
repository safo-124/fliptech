import { ghanaPhone, showPhone } from "./phone";

describe("ghanaPhone", () => {
  it("reads a Ghana mobile number however it was typed", () => {
    for (const typed of ["024 123 4567", "0241234567", "241234567", "+233 24 123 4567", "233-24-123-4567"]) {
      expect(ghanaPhone(typed)).toBe("+233241234567");
    }
  });

  it("refuses what cannot be one", () => {
    expect(ghanaPhone("")).toBeNull();
    expect(ghanaPhone("02412345")).toBeNull();
    expect(ghanaPhone("0941234567")).toBeNull();
    expect(ghanaPhone("+44 7700 900123")).toBeNull();
  });
});

describe("showPhone", () => {
  it("writes the number as people say it", () => {
    expect(showPhone("+233241234567")).toBe("024 123 4567");
    expect(showPhone("+447700900123")).toBe("+447700900123");
  });
});
