/**
 * Latitude and longitude to a point on the home page's map of Ghana.
 *
 * The same equirectangular box geo.ts was drawn in (scripts/ghana-map/
 * build-geo.mjs), so a workshop's pin lands on the region it is in. Ghana is
 * close enough to the equator that nobody can see the difference from a
 * proper projection at this size.
 */
export const MAP_BOUNDS = { south: 4.62, north: 11.22, west: -3.3, east: 1.25 } as const;
export const MAP_WIDTH = 600;
const PAD = 14;
const SCALE = (MAP_WIDTH - 2 * PAD) / (MAP_BOUNDS.east - MAP_BOUNDS.west);

export const MAP_HEIGHT = Math.round((MAP_BOUNDS.north - MAP_BOUNDS.south) * SCALE + 2 * PAD);

export function project(lat: number, lng: number): [number, number] {
  const x = PAD + (lng - MAP_BOUNDS.west) * SCALE;
  const y = PAD + (MAP_BOUNDS.north - lat) * SCALE;
  return [Math.round(x * 10) / 10, Math.round(y * 10) / 10];
}
