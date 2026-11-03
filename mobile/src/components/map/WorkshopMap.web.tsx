import { MapPlaceholder } from "./MapPlaceholder";
import type { WorkshopMapProps } from "./types";

/**
 * The web build (a development preview only: the app ships for Android).
 * MapLibre's React Native map has no web version, so this says so, and the
 * screen's buttons, chips and card still work around it.
 */
export function WorkshopMap({ workshops }: WorkshopMapProps) {
  return <MapPlaceholder title="The map shows on Android" body={`${workshops.length} workshops would be pinned here.`} />;
}
