/**
 * The map tiles, shared by the search map and the small map on a listing.
 *
 * OpenStreetMap's own tile servers are the default, which suits development.
 * Their usage policy asks busy sites to use a tile provider instead, and
 * production picks one through NEXT_PUBLIC_MAP_TILE_URL without a code change.
 */

export const DEFAULT_TILE_URL = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
const DEFAULT_TILE_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

export const TILE_URL = process.env.NEXT_PUBLIC_MAP_TILE_URL?.trim() || DEFAULT_TILE_URL;
export const TILE_ATTRIBUTION =
  process.env.NEXT_PUBLIC_MAP_TILE_ATTRIBUTION?.trim() || DEFAULT_TILE_ATTRIBUTION;

/**
 * The class that quietens the tiles, or "" when they should be left alone.
 *
 * OpenStreetMap's standard style is drawn for people reading a map: orange and
 * yellow roads, pink and green land, purple district names. Under the brand's
 * purple pins that is a lot of colour competing for one glance, so it is
 * mostly desaturated in CSS (see globals.css). A provider chosen through
 * NEXT_PUBLIC_MAP_TILE_URL is a style somebody picked, and is drawn as it comes.
 */
export function softTilesClass(url: string = TILE_URL): string {
  return url === DEFAULT_TILE_URL ? "map-soft-tiles" : "";
}
