import { useEffect, useMemo, useRef, useState } from "react";
import { StyleSheet } from "react-native";
import MapView, { Marker, PROVIDER_GOOGLE, type Region } from "react-native-maps";

import { GHANA_BOUNDS, makeClusterer, type Bounds } from "@/lib/map";

import { ClusterBubble, WorkshopPin } from "./Pins";
import type { WorkshopMapProps } from "./types";

/**
 * The workshops on Google Maps (react-native-maps), for the meantime: it is
 * built into Expo Go, so the map shows without the app's own build. Same
 * pins, bubbles and behaviour as the MapLibre map in MapLibreMap.tsx.
 *
 * A store build on Android needs a Google Maps API key in app.json
 * (android.config.googleMaps.apiKey); Expo Go brings its own.
 */
export function GoogleMap({
  workshops,
  selectedId,
  onSelect,
  onMoved,
  fitTo,
  flyTo,
  showUser,
  insets,
}: WorkshopMapProps) {
  const map = useRef<MapView>(null);
  const [view, setView] = useState<{ bounds: Bounds; zoom: number }>({ bounds: GHANA_BOUNDS, zoom: 6 });
  const itemsAt = useMemo(() => makeClusterer(workshops), [workshops]);
  const items = useMemo(() => itemsAt(view.bounds, view.zoom), [itemsAt, view]);
  const padding = { top: insets.top + 24, bottom: insets.bottom + 24, left: 32, right: 32 };

  useEffect(() => {
    if (!fitTo) return;
    const [west, south, east, north] = fitTo.bounds;
    map.current?.fitToCoordinates(
      [
        { latitude: south, longitude: west },
        { latitude: north, longitude: east },
      ],
      { edgePadding: padding, animated: true },
    );
    // Only when asked again (a new nonce), not on every inset change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitTo?.nonce]);

  useEffect(() => {
    if (flyTo) map.current?.animateToRegion(regionAt(flyTo.center, flyTo.zoom), 900);
  }, [flyTo]);

  return (
    <MapView
      ref={map}
      style={StyleSheet.absoluteFill}
      provider={PROVIDER_GOOGLE}
      initialRegion={regionOf(GHANA_BOUNDS)}
      mapPadding={{ top: 0, bottom: insets.bottom, left: 0, right: 0 }}
      showsUserLocation={showUser}
      showsMyLocationButton={false}
      showsCompass={false}
      toolbarEnabled={false}
      pitchEnabled={false}
      minZoomLevel={5}
      maxZoomLevel={18}
      onPress={(event) => {
        // A tap on a marker also reaches the map; only a tap on the map clears.
        if (event.nativeEvent.action !== "marker-press") onSelect(null);
      }}
      onRegionChangeComplete={(region, details) => {
        const bounds = boundsOf(region);
        setView({ bounds, zoom: zoomOf(region) });
        onMoved(bounds, Boolean(details?.isGesture));
      }}
    >
      {items.map((item) =>
        item.kind === "cluster" ? (
          <Marker
            key={`c${item.id}`}
            coordinate={{ latitude: item.lat, longitude: item.lng }}
            anchor={{ x: 0.5, y: 0.5 }}
            tracksViewChanges={false}
            onPress={() => map.current?.animateToRegion(regionAt([item.lng, item.lat], item.expansionZoom), 500)}
          >
            <ClusterBubble count={item.count} />
          </Marker>
        ) : (
          <Marker
            // Remounted when (de)selected: the pin is drawn once, not tracked.
            key={`w${item.id}-${item.id === selectedId}`}
            coordinate={{ latitude: item.lat, longitude: item.lng }}
            anchor={{ x: 0.5, y: 1 }}
            tracksViewChanges={false}
            onPress={() => onSelect(item.workshop)}
          >
            <WorkshopPin colour={item.workshop.trade?.colour} selected={item.id === selectedId} />
          </Marker>
        ),
      )}
    </MapView>
  );
}

function regionOf([west, south, east, north]: Bounds): Region {
  return {
    latitude: (south + north) / 2,
    longitude: (west + east) / 2,
    latitudeDelta: north - south,
    longitudeDelta: east - west,
  };
}

function boundsOf(region: Region): Bounds {
  return [
    region.longitude - region.longitudeDelta / 2,
    region.latitude - region.latitudeDelta / 2,
    region.longitude + region.longitudeDelta / 2,
    region.latitude + region.latitudeDelta / 2,
  ];
}

/** The web-map zoom level a view is at, from how many degrees it spans. */
function zoomOf(region: Region) {
  return Math.max(0, Math.min(20, Math.log2(360 / Math.max(region.longitudeDelta, 1e-6))));
}

function regionAt([lng, lat]: [number, number], zoom: number): Region {
  const delta = 360 / 2 ** zoom;
  return { latitude: lat, longitude: lng, latitudeDelta: delta, longitudeDelta: delta };
}
