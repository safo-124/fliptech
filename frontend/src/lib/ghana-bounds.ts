/**
 * Ghana's box, the same as backend geography/bounds.py.
 *
 * A listing's pin once sat in Finland, and the maps, which fit themselves to
 * every pin, opened on Europe and Africa. A pin outside this box is a data
 * mistake: maps leave it out, and start on Greater Accra when nothing is left.
 */

export const GHANA = {south: 4.5, north: 11.25, west: -3.35, east: 1.3} as const;

/** Accra, for a map with nothing in Ghana to fit to. */
export const GREATER_ACCRA_CENTRE: [number, number] = [5.6037, -0.187];
export const GREATER_ACCRA_ZOOM = 11;

export function insideGhana(lat: number, lng: number): boolean {
  return (
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    lat >= GHANA.south &&
    lat <= GHANA.north &&
    lng >= GHANA.west &&
    lng <= GHANA.east
  );
}
