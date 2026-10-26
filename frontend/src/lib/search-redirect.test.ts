import { describe, expect, it } from "vitest";

import { searchRedirectTarget } from "./search-redirect";

describe("searchRedirectTarget", () => {
  it("sends an old search link to the results page", () => {
    expect(searchRedirectTarget({ trade: "welding", area: "adenta" })).toBe(
      "/training?trade=welding&area=adenta",
    );
  });

  it("leaves a plain visit on the landing page", () => {
    expect(searchRedirectTarget({})).toBeNull();
  });

  it("does not bounce a visitor over a share or tracking parameter", () => {
    /** Somebody sent the homepage, and the link picked up a click id on the
        way. They asked for the homepage, so they get the homepage. */
    expect(searchRedirectTarget({ fbclid: "abc123", utm_source: "whatsapp" })).toBeNull();
  });

  it("drops unknown keys rather than carrying them to the results page", () => {
    expect(searchRedirectTarget({ trade: "tailoring", utm_source: "whatsapp" })).toBe(
      "/training?trade=tailoring",
    );
  });

  it("takes the first of a repeated key", () => {
    expect(searchRedirectTarget({ trade: ["welding", "tailoring"] })).toBe("/training?trade=welding");
  });

  it("ignores a key that is present but empty", () => {
    expect(searchRedirectTarget({ q: "" })).toBeNull();
  });
});
