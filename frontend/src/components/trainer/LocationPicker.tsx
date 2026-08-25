"use client";

/**
 * Drag a pin to the workshop door.
 *
 * The form previously asked for latitude and longitude as two text boxes, with
 * a "use my current location" button beside them. Neither works well for the
 * person filling this in:
 *
 *  - nobody types their own coordinates to six decimal places, and a typo in
 *    the third decimal moves the workshop about a hundred metres with nothing
 *    on screen to show it;
 *  - GPS inside a workshop with a metal roof is regularly 50-150m out in
 *    Accra, and the numbers alone give no way to see that, let alone fix it.
 *
 * A pin on a map makes the error visible and correctable, and it makes the
 * result checkable later by the field officer doing the site visit.
 *
 * The map is an aid, not the only route: the wizard keeps the coordinate
 * inputs, which is what a keyboard or screen-reader user drives. Dragging is
 * the fast path, not the required one.
 *
 * Leaflet touches `window` at import time, so this is loaded through
 * `dynamic(..., {ssr: false})` — see LocationPickerField.
 */

import L from "leaflet";
import {useEffect, useMemo, useRef, type RefObject} from "react";
import {MapContainer, Marker, TileLayer, useMap, useMapEvents} from "react-leaflet";
import "leaflet/dist/leaflet.css";

const DEFAULT_TILE_URL = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
const DEFAULT_TILE_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

const TILE_URL = process.env.NEXT_PUBLIC_MAP_TILE_URL?.trim() || DEFAULT_TILE_URL;
const TILE_ATTRIBUTION =
  process.env.NEXT_PUBLIC_MAP_TILE_ATTRIBUTION?.trim() || DEFAULT_TILE_ATTRIBUTION;

/** Independence Square, used only when there is nothing better to centre on. */
const ACCRA: [number, number] = [5.5502, -0.1968];

const PLACED_ZOOM = 17;
const AREA_ZOOM = 13;

const pinIcon = L.divIcon({
  html: `<div aria-hidden="true" style="width:44px;height:44px;display:grid;place-items:center">
    <div style="width:24px;height:24px;border-radius:50% 50% 50% 0;transform:rotate(-45deg);background:var(--color-brand-strong,#b45309);border:3px solid #fff;box-shadow:0 4px 12px rgba(20,24,31,.4)"></div>
  </div>`,
  className: "",
  iconSize: [44, 44],
  iconAnchor: [22, 34],
});

export type LatLng = {lat: number; lng: number};

function parse(value: string): number | null {
  if (value.trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function ClickToPlace({onPick}: {onPick: (next: LatLng) => void}) {
  useMapEvents({
    click(event) {
      onPick({lat: event.latlng.lat, lng: event.latlng.lng});
    },
  });
  return null;
}

/**
 * Follow a position set from outside the map — the "use my location" button,
 * or an area chosen before the pin has been placed.
 *
 * `placed` is tracked so panning to the selected area does not yank the map
 * away from a pin the owner has already dragged into position.
 */
function Recentre({
  position,
  placed,
  fromMapRef,
}: {
  position: [number, number];
  placed: boolean;
  fromMapRef: RefObject<boolean>;
}) {
  const map = useMap();
  const previous = useRef<string>("");

  useEffect(() => {
    const key = position.join(",");
    if (previous.current === key) return;
    previous.current = key;
    // A drag or a tap already put the pin exactly where it was aimed. Panning
    // to centre it would yank the map out from under the finger doing the
    // adjusting, which is the opposite of helpful.
    if (fromMapRef.current) {
      fromMapRef.current = false;
      return;
    }
    map.setView(position, placed ? Math.max(map.getZoom(), PLACED_ZOOM) : AREA_ZOOM, {
      animate: true,
    });
  }, [fromMapRef, map, placed, position]);

  return null;
}

export default function LocationPicker({
  latitude,
  longitude,
  areaCentroid,
  onChange,
}: {
  latitude: string;
  longitude: string;
  areaCentroid?: LatLng | null;
  onChange: (next: LatLng) => void;
}) {
  const lat = parse(latitude);
  const lng = parse(longitude);
  const placed = lat !== null && lng !== null;

  const position = useMemo<[number, number]>(() => {
    if (lat !== null && lng !== null) return [lat, lng];
    if (areaCentroid) return [areaCentroid.lat, areaCentroid.lng];
    return ACCRA;
  }, [areaCentroid, lat, lng]);

  const markerRef = useRef<L.Marker>(null);
  // Set just before a change that came from the map itself, so Recentre can
  // tell "the owner moved the pin" from "something else moved it".
  const fromMapRef = useRef(false);

  function pick(next: LatLng) {
    fromMapRef.current = true;
    onChange(next);
  }

  return (
    <div className="overflow-hidden rounded-xl border border-[var(--color-border)]">
      <MapContainer
        center={position}
        zoom={placed ? PLACED_ZOOM : AREA_ZOOM}
        scrollWheelZoom={false}
        style={{height: "16rem", width: "100%"}}
        // The map duplicates the coordinate inputs beside it, which are the
        // accessible control. Keeping it out of the tab order avoids trapping
        // a keyboard user in a pan-and-zoom widget they cannot place a pin with.
        keyboard={false}
      >
        <TileLayer url={TILE_URL} attribution={TILE_ATTRIBUTION} />
        <ClickToPlace onPick={pick} />
        <Recentre position={position} placed={placed} fromMapRef={fromMapRef} />
        {placed ? (
          <Marker
            position={position}
            icon={pinIcon}
            draggable
            ref={markerRef}
            eventHandlers={{
              dragend() {
                const marker = markerRef.current;
                if (!marker) return;
                const {lat: nextLat, lng: nextLng} = marker.getLatLng();
                pick({lat: nextLat, lng: nextLng});
              },
            }}
          />
        ) : null}
      </MapContainer>
    </div>
  );
}
