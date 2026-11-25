import { describe, expect, it } from "vitest";

import type { MapPin } from "@/lib/types";

import { GEO } from "./geo";
import { daysSince, placePins, summarise } from "./pins";
import { MAP_HEIGHT, MAP_WIDTH, project } from "./project";

function pin(id: number, over: Partial<MapPin> = {}): MapPin {
  return {
    id,
    name: `Workshop ${id}`,
    slug: `workshop-${id}`,
    area: "Accra",
    area_slug: "accra",
    region: "Greater Accra",
    region_slug: "greater-accra",
    primary_photo: null,
    trade: { name: "Welding", slug: "welding", colour: "red" },
    lat: 5.6037,
    lng: -0.187,
    has_shop: false,
    joined: "2026-11-20T10:00:00Z",
    ...over,
  };
}

const KUMASI = { area: "Kumasi", area_slug: "kumasi", region: "Ashanti", region_slug: "ashanti", lat: 6.688, lng: -1.624 };
const TEMA = { area: "Tema", area_slug: "tema", lat: 5.669, lng: -0.017 };

describe("project", () => {
  it("uses the same box the regions were drawn in", () => {
    expect([MAP_WIDTH, MAP_HEIGHT]).toEqual([GEO.width, GEO.height]);
  });

  it("puts the north west corner top left and the south east bottom right", () => {
    expect(project(11.22, -3.3)).toEqual([14, 14]);
    const [x, y] = project(4.62, 1.25);
    expect(x).toBeCloseTo(MAP_WIDTH - 14, 0);
    expect(y).toBeCloseTo(MAP_HEIGHT - 14, 0);
  });
});

describe("placePins", () => {
  it("keeps a lone workshop as its own pin", () => {
    const placed = placePins([pin(1), pin(2, KUMASI)]);
    expect(placed.map((item) => item.kind)).toEqual(["pin", "pin"]);
  });

  it("gathers a town's workshops into one bubble that opens that town", () => {
    const [group] = placePins([pin(1), pin(2, { lat: 5.61 }), pin(3, { lng: -0.18 })]);
    expect(group).toMatchObject({ kind: "group", place: "Accra", href: "/map?area=accra" });
    expect(group.kind === "group" && group.pins).toHaveLength(3);
  });

  it("opens the region when a bubble spans towns in one region", () => {
    const [group] = placePins([pin(1), pin(2, TEMA)], 40);
    expect(group).toMatchObject({ kind: "group", place: "Greater Accra", href: "/map?region=greater-accra" });
  });

  it("leaves off a pin outside Ghana", () => {
    expect(placePins([pin(1, { lat: 60.17, lng: 24.94 })])).toEqual([]);
  });

  it("draws southern pins last, over the ones behind them", () => {
    const placed = placePins([pin(1), pin(2, KUMASI)]);
    expect(placed.map((item) => (item.kind === "pin" ? item.pin.id : 0))).toEqual([2, 1]);
  });
});

describe("summarise", () => {
  it("counts workshops, shops, towns and regions, busiest region first", () => {
    const summary = summarise([pin(1, { has_shop: true }), pin(2), pin(3, KUMASI), pin(4, TEMA)]);
    expect(summary).toMatchObject({ workshops: 4, shops: 1, towns: 3 });
    expect(summary.regions).toEqual([
      { name: "Greater Accra", slug: "greater-accra", count: 3 },
      { name: "Ashanti", slug: "ashanti", count: 1 },
    ]);
  });

  it("lists the three newest", () => {
    const summary = summarise([
      pin(1, { joined: "2026-01-01T00:00:00Z" }),
      pin(2, { joined: "2026-11-24T00:00:00Z" }),
      pin(3, { joined: "2026-06-01T00:00:00Z" }),
      pin(4, { joined: "2026-11-01T00:00:00Z" }),
    ]);
    expect(summary.newest.map((p) => p.id)).toEqual([2, 4, 3]);
  });
});

describe("daysSince", () => {
  const now = new Date("2026-11-25T09:00:00Z");
  it("counts whole days", () => {
    expect(daysSince("2026-11-25T08:00:00Z", now)).toBe(0);
    expect(daysSince("2026-11-24T08:00:00Z", now)).toBe(1);
    expect(daysSince("2026-11-15T09:00:00Z", now)).toBe(10);
  });
  it("never goes below zero", () => {
    expect(daysSince("2026-11-26T09:00:00Z", now)).toBe(0);
  });
});
