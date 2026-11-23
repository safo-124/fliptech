import { Linking, Platform } from "react-native";

type Place = { lat: number; lng: number; name: string };

/**
 * The phone's own maps app at a place, with its name on the pin. Android's
 * geo: opens whichever maps app the phone has; an iPhone has no geo:, so it
 * gets Apple Maps' own address, which opens the Maps app.
 */
export function mapsUrl({ lat, lng, name }: Place, os: string = Platform.OS) {
  const label = encodeURIComponent(name);
  return os === "ios"
    ? `https://maps.apple.com/?ll=${lat},${lng}&q=${label}`
    : `geo:${lat},${lng}?q=${lat},${lng}(${label})`;
}

/** The same place on OpenStreetMap, in the browser. */
export function webMapUrl({ lat, lng }: Place) {
  return `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=17/${lat}/${lng}`;
}

/** Open the place in the phone's maps app, or the web map when none opens. */
export function openDirections(place: Place) {
  Linking.openURL(mapsUrl(place)).catch(() => Linking.openURL(webMapUrl(place)).catch(() => undefined));
}
