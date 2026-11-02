import { bboxParam, boundsOf, makeClusterer, mappable, rasterStyle, type Bounds } from "./map";
import type { ProviderCard } from "./types";

function workshop(id: number, lat: number, lng: number): ProviderCard {
  return {
    id,
    name: `Workshop ${id}`,
    slug: `w-${id}`,
    area: "Madina",
    area_slug: "madina",
    region: "Greater Accra",
    lowest_fee: null,
    shortest_duration_weeks: null,
    next_intake: null,
    primary_photo: null,
    trade: null,
    lat,
    lng,
  };
}

const ACCRA = workshop(1, 5.6037, -0.187);
const NEXT_DOOR = workshop(2, 5.6041, -0.1866);
const KUMASI = workshop(3, 6.6885, -1.6244);
const NOWHERE = workshop(4, 0, 0);
const GHANA: Bounds = [-3.3, 4.7, 1.2, 11.2];

describe("the map's helpers", () => {
  it("leaves out workshops without a real position", () => {
    expect(mappable([ACCRA, NOWHERE]).map((w) => w.id)).toEqual([1]);
  });

  it("frames every workshop with a little room around them", () => {
    const [west, south, east, north] = boundsOf([ACCRA, KUMASI, NOWHERE])!;
    expect(west).toBeLessThan(-1.6244);
    expect(east).toBeGreaterThan(-0.187);
    expect(south).toBeLessThan(5.6037);
    expect(north).toBeGreaterThan(6.6885);
    expect(boundsOf([])).toBeNull();
  });

  it("writes the box the way the API reads it: minLng,minLat,maxLng,maxLat", () => {
    expect(bboxParam([-0.5, 5.4, 0.3, 6])).toBe("-0.5000,5.4000,0.3000,6.0000");
  });

  it("groups neighbours into one bubble when zoomed out, and parts them when zoomed in", () => {
    const itemsAt = makeClusterer([ACCRA, NEXT_DOOR, KUMASI]);
    const far = itemsAt(GHANA, 6);
    expect(far.filter((i) => i.kind === "cluster").map((i) => (i.kind === "cluster" ? i.count : 0))).toEqual([2]);
    expect(far.filter((i) => i.kind === "workshop").map((i) => i.id)).toEqual([3]);

    const near = itemsAt([-0.2, 5.59, -0.17, 5.62], 18);
    expect(near.map((i) => i.id).sort()).toEqual([1, 2]);
    expect(near.every((i) => i.kind === "workshop")).toBe(true);
  });

  it("uses one raster layer of the configured tiles, with their credit", () => {
    const style = rasterStyle("https://tiles.example/{z}/{x}/{y}.png", "© Example");
    expect(style.sources.tiles.tiles).toEqual(["https://tiles.example/{z}/{x}/{y}.png"]);
    expect(style.sources.tiles.attribution).toBe("© Example");
    expect(style.layers).toHaveLength(1);
  });
});
