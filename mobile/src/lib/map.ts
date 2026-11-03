import Supercluster from "supercluster";

import type { ProviderCard } from "./types";

/**
 * The map's tiles: OpenStreetMap's standard raster tiles, as the website
 * uses (frontend/src/lib/map-tiles.ts), until a tile provider is set.
 *
 * OpenStreetMap asks apps and busy sites to use a provider (MapTiler,
 * Stadia Maps and others have free tiers). Set EXPO_PUBLIC_MAP_TILE_URL and
 * EXPO_PUBLIC_MAP_TILE_ATTRIBUTION to its raster tile address and credit;
 * one key can serve the website and the app.
 */
export const TILE_URL =
  process.env.EXPO_PUBLIC_MAP_TILE_URL?.trim() || "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
export const TILE_ATTRIBUTION =
  process.env.EXPO_PUBLIC_MAP_TILE_ATTRIBUTION?.trim() || "© OpenStreetMap contributors";

/** Ghana, whole, for a first look when nothing better is known. */
export const GHANA_BOUNDS: Bounds = [-3.3, 4.7, 1.2, 11.2];

/** [west, south, east, north], in degrees. */
export type Bounds = [number, number, number, number];

/** A MapLibre style of one raster layer: the tiles and nothing else. */
export function rasterStyle(url = TILE_URL, attribution = TILE_ATTRIBUTION) {
  return {
    version: 8 as const,
    sources: {
      tiles: {
        type: "raster" as const,
        tiles: [url],
        tileSize: 256,
        maxzoom: 19,
        attribution,
      },
    },
    layers: [{ id: "tiles", type: "raster" as const, source: "tiles" }],
  };
}

/** Workshops with a usable position. Some listings have none yet. */
export function mappable(workshops: ProviderCard[]) {
  return workshops.filter(
    (w) => Number.isFinite(w.lat) && Number.isFinite(w.lng) && !(w.lat === 0 && w.lng === 0),
  );
}

/** The box around every workshop, padded a little; null when there are none. */
export function boundsOf(workshops: ProviderCard[]): Bounds | null {
  const points = mappable(workshops);
  if (!points.length) return null;
  let [west, south, east, north] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const w of points) {
    west = Math.min(west, w.lng);
    east = Math.max(east, w.lng);
    south = Math.min(south, w.lat);
    north = Math.max(north, w.lat);
  }
  // One workshop, or several on one street, still shows the area around it.
  const pad = Math.max(0.01, (east - west) * 0.08, (north - south) * 0.08);
  return [west - pad, south - pad, east + pad, north + pad];
}

/** The API's bbox parameter: minLng,minLat,maxLng,maxLat, rounded. */
export function bboxParam([west, south, east, north]: Bounds) {
  return [west, south, east, north].map((n) => n.toFixed(4)).join(",");
}

export type MapItem =
  | { kind: "workshop"; id: number; lng: number; lat: number; workshop: ProviderCard }
  | { kind: "cluster"; id: number; lng: number; lat: number; count: number; expansionZoom: number };

type Props = { workshopId: number };

/**
 * Groups workshops that would overlap at the current zoom into one bubble
 * with a count, as the website's map does (supercluster, same settings).
 */
export function makeClusterer(workshops: ProviderCard[]) {
  const byId = new Map(workshops.map((w) => [w.id, w]));
  const index = new Supercluster<Props, Record<string, never>>({ radius: 56, maxZoom: 16 });
  index.load(
    mappable(workshops).map((w) => ({
      type: "Feature" as const,
      properties: { workshopId: w.id },
      geometry: { type: "Point" as const, coordinates: [w.lng, w.lat] },
    })),
  );
  return function itemsAt(bounds: Bounds, zoom: number): MapItem[] {
    return index.getClusters(bounds, Math.round(zoom)).flatMap((feature): MapItem[] => {
      const [lng, lat] = feature.geometry.coordinates;
      const props = feature.properties as Partial<Supercluster.ClusterProperties> & Partial<Props>;
      if (props.cluster && typeof props.cluster_id === "number") {
        return [
          {
            kind: "cluster",
            id: props.cluster_id,
            lng,
            lat,
            count: props.point_count ?? 0,
            expansionZoom: Math.min(index.getClusterExpansionZoom(props.cluster_id), 17),
          },
        ];
      }
      const workshop = props.workshopId !== undefined ? byId.get(props.workshopId) : undefined;
      return workshop ? [{ kind: "workshop", id: workshop.id, lng, lat, workshop }] : [];
    });
  };
}
