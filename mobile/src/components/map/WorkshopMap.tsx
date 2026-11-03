import { useState, type ComponentType } from "react";
import { TurboModuleRegistry } from "react-native";

import type { WorkshopMapProps } from "./types";

/**
 * MapLibre (OpenStreetMap, like the website) is native code, only in the
 * app's own build, not in Expo Go; importing it where it is missing crashes
 * the whole app at load. Google Maps (react-native-maps), which Expo Go
 * includes, is used in the meantime.
 *
 * Neither library is loaded until the map is first shown, so nothing about
 * maps runs while the app starts.
 */
function loadMap(): ComponentType<WorkshopMapProps> {
  /* eslint-disable @typescript-eslint/no-require-imports */
  if (TurboModuleRegistry.get("MLRNCameraModule") != null) {
    return (require("./MapLibreMap") as typeof import("./MapLibreMap")).MapLibreMap;
  }
  return (require("./GoogleMap") as typeof import("./GoogleMap")).GoogleMap;
  /* eslint-enable @typescript-eslint/no-require-imports */
}

export function WorkshopMap(props: WorkshopMapProps) {
  const [Map] = useState(loadMap);
  return <Map {...props} />;
}
