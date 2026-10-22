/**
 * A Google Maps route to a point. On a phone it opens the Maps app.
 *
 * Google Maps rather than a geo: link, which opens nothing in most desktop
 * browsers and an app picker on Android. The origin is left out on purpose:
 * someone following this wants directions from wherever they are standing.
 */
export function directionsUrl(lat: number, lng: number): string {
  const destination = `${lat.toFixed(6)},${lng.toFixed(6)}`;
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(destination)}`;
}

/** Whether a listing has a pin worth drawing or routing to. */
export function hasPin(place: { lat: number | null | undefined; lng: number | null | undefined }) {
  return Number.isFinite(place.lat) && Number.isFinite(place.lng);
}
