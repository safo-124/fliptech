import { Camera, Map, Marker, UserLocation, type CameraRef } from "@maplibre/maplibre-react-native";
import { useEffect, useMemo, useRef, useState } from "react";
import { StyleSheet } from "react-native";

import { GHANA_BOUNDS, makeClusterer, rasterStyle, type Bounds } from "@/lib/map";
import { colors } from "@/theme/tokens";

import { ClusterBubble, WorkshopPin } from "./Pins";
import type { WorkshopMapProps } from "./types";

const STYLE = rasterStyle();

/**
 * The workshops on a MapLibre map, Android and iOS. Pins and cluster
 * bubbles are React Native views placed on the map (Markers), regrouped
 * each time the view settles. Loaded by WorkshopMap.tsx only when MapLibre is in the app.
 */
export function MapLibreMap({
  workshops,
  selectedId,
  onSelect,
  onMoved,
  fitTo,
  flyTo,
  showUser,
  insets,
}: WorkshopMapProps) {
  const camera = useRef<CameraRef>(null);
  const [view, setView] = useState<{ bounds: Bounds; zoom: number }>({ bounds: GHANA_BOUNDS, zoom: 6 });
  const itemsAt = useMemo(() => makeClusterer(workshops), [workshops]);
  const items = useMemo(() => itemsAt(view.bounds, view.zoom), [itemsAt, view]);
  const padding = { top: insets.top + 24, bottom: insets.bottom + 24, left: 32, right: 32 };

  useEffect(() => {
    if (fitTo) camera.current?.fitBounds(fitTo.bounds, { padding, duration: 600 });
    // Only when asked again (a new nonce), not on every inset change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitTo?.nonce]);

  useEffect(() => {
    if (flyTo) camera.current?.flyTo({ center: flyTo.center, zoom: flyTo.zoom, duration: 900 });
  }, [flyTo]);

  return (
    <Map
      style={StyleSheet.absoluteFill}
      mapStyle={STYLE}
      logo={false}
      compass={false}
      attribution
      attributionPosition={{ bottom: insets.bottom + 4, left: 8 }}
      tintColor={colors.brand}
      touchPitch={false}
      onPress={() => onSelect(null)}
      onRegionDidChange={(event) => {
        const { bounds, zoom, userInteraction } = event.nativeEvent;
        setView({ bounds, zoom });
        onMoved(bounds, userInteraction);
      }}
    >
      <Camera ref={camera} initialViewState={{ bounds: GHANA_BOUNDS }} minZoom={5} maxZoom={18} />
      {showUser ? <UserLocation animated accuracy /> : null}
      {items.map((item) =>
        item.kind === "cluster" ? (
          <Marker
            key={`c${item.id}`}
            id={`c${item.id}`}
            lngLat={[item.lng, item.lat]}
            anchor="center"
            onPress={() =>
              camera.current?.easeTo({ center: [item.lng, item.lat], zoom: item.expansionZoom, duration: 500 })
            }
          >
            <ClusterBubble count={item.count} />
          </Marker>
        ) : (
          <Marker
            key={`w${item.id}`}
            id={`w${item.id}`}
            lngLat={[item.lng, item.lat]}
            anchor="bottom"
            onPress={() => onSelect(item.workshop)}
          >
            <WorkshopPin colour={item.workshop.trade?.colour} selected={item.id === selectedId} />
          </Marker>
        ),
      )}
    </Map>
  );
}
