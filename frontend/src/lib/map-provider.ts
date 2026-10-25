/**
 * What the map draws, and nothing else.
 *
 * SearchMapPanel renders nothing below 1024px and `dynamic()` keeps Leaflet
 * off a phone entirely — but props are not gated the way the import is. They
 * are serialised into the RSC payload on every request, whatever the viewport,
 * so a phone that never sees a map was still paying to send every result's
 * photo URL, logo URL, trade and government status across the wire a second
 * time, having already received all of it as rendered markup.
 *
 * MapView reads eleven fields. This sends eleven. The map behaves exactly as
 * before; the phone stops carrying the other eight, two of them nested
 * objects.
 */

import type { ProviderCard } from "./types";

export type MapProvider = Pick<
  ProviderCard,
  | "id"
  | "name"
  | "slug"
  | "area"
  | "area_slug"
  | "lat"
  | "lng"
  | "lowest_fee"
  | "site_visit"
  // Both are read by pinIcon: the pin carries the workshop's own picture.
  | "primary_photo"
  | "logo"
>;

/**
 * Narrow a result set to the map's fields.
 *
 * Written out rather than looped over a key list so that TypeScript fails the
 * build if MapView starts reading a field this does not send — the failure
 * mode otherwise is a popup that silently renders `undefined`.
 */
export function toMapProviders(providers: readonly ProviderCard[]): MapProvider[] {
  return providers.map((provider) => ({
    id: provider.id,
    name: provider.name,
    slug: provider.slug,
    area: provider.area,
    area_slug: provider.area_slug,
    lat: provider.lat,
    lng: provider.lng,
    lowest_fee: provider.lowest_fee,
    site_visit: provider.site_visit,
    primary_photo: provider.primary_photo,
    logo: provider.logo,
  }));
}
