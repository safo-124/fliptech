import {describe, expect, it} from "vitest";

import {directionsUrl, hasPin} from "./directions";

describe("directions", () => {
  it("routes from wherever the trainee is to the workshop's pin", () => {
    const url = new URL(directionsUrl(5.56, -0.205));

    expect(url.origin + url.pathname).toBe("https://www.google.com/maps/dir/");
    expect(url.searchParams.get("api")).toBe("1");
    expect(url.searchParams.get("destination")).toBe("5.560000,-0.205000");
    // No origin, so the phone starts from where it is.
    expect(url.searchParams.has("origin")).toBe(false);
  });

  it("offers no map or route without a usable pin", () => {
    expect(hasPin({lat: 5.56, lng: -0.205})).toBe(true);
    expect(hasPin({lat: null, lng: -0.205})).toBe(false);
    expect(hasPin({lat: Number.NaN, lng: 0})).toBe(false);
  });
});
