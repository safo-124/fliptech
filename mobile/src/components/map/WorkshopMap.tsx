import type { ComponentType } from "react";
import { TurboModuleRegistry } from "react-native";

import { GoogleMap } from "./GoogleMap";
import type { WorkshopMapProps } from "./types";

/**
 * MapLibre (OpenStreetMap, like the website) is native code, only in the
 * app's own build, not in Expo Go; importing it where it is missing crashes
 * the whole app at load. So it is loaded only when its native module is
 * there, and Google Maps, which Expo Go includes, is used in the meantime.
 */
const hasMapLibre = TurboModuleRegistry.get("MLRNCameraModule") != null;

const Map: ComponentType<WorkshopMapProps> = hasMapLibre
  ? // eslint-disable-next-line @typescript-eslint/no-require-imports
    (require("./MapLibreMap") as typeof import("./MapLibreMap")).MapLibreMap
  : GoogleMap;

export function WorkshopMap(props: WorkshopMapProps) {
  return <Map {...props} />;
}
