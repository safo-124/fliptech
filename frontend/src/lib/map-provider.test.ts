import { describe, expect, it } from "vitest";

import { toMapProviders } from "./map-provider";
import type { ProviderCard } from "./types";

const card: ProviderCard = {
  id: 7,
  name: "VIS Leather and Silk Atelier",
  slug: "vis-leather-and-silk-atelier",
  area: "Adenta",
  area_slug: "adenta",
  region: "Greater Accra",
  lowest_fee: "500.00",
  shortest_duration_weeks: 2,
  next_intake: "2026-12-14",
  distance_m: null,
  site_visit: null,
  government_status: { label: "Not claimed", registration_status: "not_claimed" },
  primary_photo: "https://example.test/media/providers/2026/10/image.jpg",
  logo: "https://example.test/media/logos/2026/10/logo.png",
  trade: { name: "Tailoring", slug: "tailoring", colour: "dye" },
  lat: 5.745,
  lng: -0.1455,
  listing_confirmed_on: "2026-10-23T21:16:09Z",
  is_stale: false,
};

describe("toMapProviders", () => {
  it("keeps what a marker and its popup draw", () => {
    const [mapped] = toMapProviders([card]);

    expect(mapped).toEqual({
      id: 7,
      name: "VIS Leather and Silk Atelier",
      slug: "vis-leather-and-silk-atelier",
      area: "Adenta",
      area_slug: "adenta",
      lat: 5.745,
      lng: -0.1455,
      lowest_fee: "500.00",
      site_visit: null,
      primary_photo: "https://example.test/media/providers/2026/10/image.jpg",
      logo: "https://example.test/media/logos/2026/10/logo.png",
    });
  });

  it("drops the fields the map never reads", () => {
    /**
     * The point of the whole module. SearchMapPanel renders nothing on a
     * phone, but its props still cross the wire, so anything left in here is
     * weight every mobile visitor carries for a map they will not see — and
     * the search page has little room left against the 200 KB budget.
     */
    const [mapped] = toMapProviders([card]);

    for (const dropped of [
      "region",
      "shortest_duration_weeks",
      "next_intake",
      "distance_m",
      "government_status",
      "trade",
      "listing_confirmed_on",
      "is_stale",
    ]) {
      expect(mapped).not.toHaveProperty(dropped);
    }
  });

  it("is empty for an empty result set", () => {
    expect(toMapProviders([])).toEqual([]);
  });
});
