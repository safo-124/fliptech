"use client";

/**
 * The listing's small map itself. Loaded through ProviderLocationMap, never
 * imported directly: Leaflet touches `window` at import time.
 *
 * A picture of where the workshop is rather than a map to explore, so every
 * gesture is off. A map inside a scrolling page catches the thumb that was
 * only trying to scroll past it, and the search map is a tap away for anyone
 * who wants to look around.
 */

import { MapContainer, Marker, TileLayer } from "react-leaflet";
import "leaflet/dist/leaflet.css";

import { softTilesClass, TILE_ATTRIBUTION, TILE_URL } from "@/lib/map-tiles";
import type { ProviderCard } from "@/lib/types";

import { pinIcon } from "./map/pins";

export type MapPlace = Pick<ProviderCard, "lat" | "lng" | "primary_photo" | "logo">;

export default function ProviderLocationMapView({ place }: { place: MapPlace }) {
  return (
    <MapContainer
      center={[place.lat, place.lng]}
      zoom={16}
      className={softTilesClass()}
      style={{ height: "100%", width: "100%" }}
      zoomControl={false}
      dragging={false}
      touchZoom={false}
      doubleClickZoom={false}
      scrollWheelZoom={false}
      boxZoom={false}
      keyboard={false}
    >
      <TileLayer url={TILE_URL} attribution={TILE_ATTRIBUTION} />
      <Marker
        position={[place.lat, place.lng]}
        icon={pinIcon(place)}
        interactive={false}
        keyboard={false}
      />
    </MapContainer>
  );
}
