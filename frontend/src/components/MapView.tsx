"use client";

/**
 * Screen 2: the map. A secondary view, never the default.
 *
 * A caution worth repeating from Section 04: the map wins demonstrations and
 * loses users. It is reached from the List/Map toggle and nothing routes to it
 * automatically.
 *
 * Three Leaflet specifics that are easy to get wrong:
 *  - Leaflet touches `window` at import time, so this whole component is loaded
 *    with `dynamic(..., { ssr: false })` from the page.
 *  - Its default marker icons resolve relative to the CSS file and break under
 *    a bundler, so icons are defined explicitly here.
 *  - Clustering uses supercluster rather than leaflet.markercluster, which has
 *    no maintained React 19 wrapper. Supercluster is pure computation, so the
 *    React version is irrelevant to it.
 */

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { MapContainer, Marker, Popup, TileLayer, useMap, useMapEvents } from "react-leaflet";
import Supercluster from "supercluster";
import L from "leaflet";
import Link from "next/link";
import "leaflet/dist/leaflet.css";

import { BRAND } from "@/lib/brand";
import { formatFee } from "@/lib/format";
import type { ProviderCard } from "@/lib/types";

const DEFAULT_TILE_URL = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
const DEFAULT_TILE_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

const TILE_URL = process.env.NEXT_PUBLIC_MAP_TILE_URL?.trim() || DEFAULT_TILE_URL;
const TILE_ATTRIBUTION =
  process.env.NEXT_PUBLIC_MAP_TILE_ATTRIBUTION?.trim() || DEFAULT_TILE_ATTRIBUTION;

function clusterIcon(count: number) {
  const size = count < 10 ? 34 : count < 50 ? 42 : 50;
  return L.divIcon({
    html: `<div aria-hidden="true" style="width:${size}px;height:${size}px;border-radius:50%;background:#14181f;color:#fff;display:flex;align-items:center;justify-content:center;font:600 13px/1 system-ui;border:2px solid #fff">${count}</div>`,
    className: "",
    iconSize: [size, size],
  });
}

const pinIcon = L.divIcon({
  html: `<div style="width:22px;height:22px;border-radius:50%;background:#b03a1a;border:3px solid #fff;box-shadow:0 1px 3px rgba(0,0,0,.4)"></div>`,
  className: "",
  iconSize: [22, 22],
  iconAnchor: [11, 11],
});

type ClusterPoint = {
  type: "Feature";
  properties: { cluster: false; provider: ProviderCard };
  geometry: { type: "Point"; coordinates: [number, number] };
};

type Viewport = { bounds: [number, number, number, number]; zoom: number };

function viewportOf(map: L.Map): Viewport {
  const b = map.getBounds();
  return {
    bounds: [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()],
    zoom: map.getZoom(),
  };
}

function Clusters({ providers }: { providers: ProviderCard[] }) {
  const map = useMap();

  // Seeded from the map during the first render rather than in an effect.
  // Setting state synchronously inside an effect causes a cascading second
  // render on every mount, which on a mid-range Android is a visible stutter.
  const [viewport, setViewport] = useState<Viewport>(() => viewportOf(map));
  const { bounds, zoom } = viewport;

  useMapEvents({ moveend: () => setViewport(viewportOf(map)) });

  const index = useMemo(() => {
    const cluster = new Supercluster<ClusterPoint["properties"]>({ radius: 60, maxZoom: 16 });
    cluster.load(
      providers.map((provider) => ({
        type: "Feature" as const,
        properties: { cluster: false as const, provider },
        geometry: {
          type: "Point" as const,
          coordinates: [provider.lng, provider.lat] as [number, number],
        },
      })),
    );
    return cluster;
  }, [providers]);

  const items = useMemo(() => index.getClusters(bounds, Math.round(zoom)), [index, bounds, zoom]);

  return (
    <>
      {items.map((item) => {
        const [lng, lat] = item.geometry.coordinates;
        // At national zoom, dense areas collapse into a count: Greater Accra
        // holds most of the inventory and would otherwise obscure the map.
        if ("cluster" in item.properties && item.properties.cluster) {
          const count = item.properties.point_count as number;
          return (
            <Marker
              key={`cluster-${item.id}`}
              position={[lat, lng]}
              icon={clusterIcon(count)}
              keyboard
              riseOnHover
              title={`${count} providers. Open to zoom in.`}
              alt={`${count} provider locations`}
              eventHandlers={{
                click: () => map.setView([lat, lng], index.getClusterExpansionZoom(item.id as number)),
              }}
            />
          );
        }

        const provider = (item.properties as ClusterPoint["properties"]).provider;
        return (
          <Marker
            key={provider.id}
            position={[lat, lng]}
            icon={pinIcon}
            keyboard
            riseOnHover
            title={`Open ${provider.name}`}
            alt={`${provider.name} training provider`}
          >
            {/* Selecting a pin raises the same comparison the list supports. */}
            <Popup>
              <strong className="block text-sm">{provider.name}</strong>
              <span className="block text-xs">{formatFee(provider.lowest_fee)}</span>
              <span className="block text-xs">
                {provider.site_visit ? `Visited by ${BRAND}` : "Not visited"}
              </span>
              <Link
                href={`/${provider.area_slug}/${provider.slug}`}
                className="mt-1 inline-block text-xs underline"
              >
                See details
              </Link>
            </Popup>
          </Marker>
        );
      })}
    </>
  );
}

function fitProviderBounds(map: L.Map, bounds: L.LatLngBounds) {
  map.fitBounds(bounds, {
    animate: false,
    maxZoom: 14,
    padding: [32, 32],
  });
}

function FitProviderBounds({ bounds }: { bounds: L.LatLngBounds }) {
  const map = useMap();

  useEffect(() => {
    fitProviderBounds(map, bounds);
  }, [bounds, map]);

  return null;
}

function MapAccessibility({
  labelId,
  instructionsId,
}: {
  labelId: string;
  instructionsId: string;
}) {
  const map = useMap();

  useEffect(() => {
    const container = map.getContainer();
    container.setAttribute("role", "region");
    container.setAttribute("aria-labelledby", labelId);
    container.setAttribute("aria-describedby", instructionsId);

    const closePopup = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        map.closePopup();
      }
    };
    container.addEventListener("keydown", closePopup);
    return () => container.removeEventListener("keydown", closePopup);
  }, [instructionsId, labelId, map]);

  return null;
}

function hasValidCoordinates(provider: ProviderCard) {
  return (
    Number.isFinite(provider.lat) &&
    Number.isFinite(provider.lng) &&
    provider.lat >= -90 &&
    provider.lat <= 90 &&
    provider.lng >= -180 &&
    provider.lng <= 180
  );
}

export default function MapView({
  providers,
  fillParent = false,
}: {
  providers: ProviderCard[];
  /** Fill the parent's height instead of a fixed viewport fraction. Used by the
      search-page side panel, which is already height-constrained. */
  fillParent?: boolean;
}) {
  const ref = useRef<L.Map | null>(null);
  const labelId = useId();
  const instructionsId = useId();
  const [tileError, setTileError] = useState(false);
  const validProviders = useMemo(() => providers.filter(hasValidCoordinates), [providers]);
  const bounds = useMemo(
    () => L.latLngBounds(validProviders.map((provider) => [provider.lat, provider.lng])),
    [validProviders],
  );

  if (validProviders.length === 0) {
    return (
      <div
        className="grid place-items-center bg-[var(--color-muted)]/35 px-6 text-center"
        style={{ height: fillParent ? "100%" : "70dvh" }}
        role="status"
      >
        <div>
          <h2 className="text-base font-semibold">No usable locations</h2>
          <p className="mt-2 text-sm text-[var(--color-muted-foreground)]">
            These providers are still available in the list view.
          </p>
        </div>
      </div>
    );
  }

  return (
    <section
      className="flex min-h-0 flex-col bg-[var(--color-card)]"
      style={{ height: fillParent ? "100%" : "70dvh" }}
      data-provider-map
    >
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--color-border)] px-3 py-2">
        <div className="min-w-0">
          <h2 id={labelId} className="text-xs font-semibold text-[var(--color-foreground)]">
            Interactive map · {validProviders.length} {validProviders.length === 1 ? "provider" : "providers"}
          </h2>
          <p id={instructionsId} className="mt-0.5 text-[11px] leading-4 text-[var(--color-muted-foreground)]">
            Use arrow keys to pan, + and − to zoom, and Tab then Enter to open a marker.
            Press Escape to close details.
          </p>
        </div>
        <button
          type="button"
          className="tap shrink-0 rounded-md border border-[var(--color-border)] bg-[var(--color-background)] px-3 text-xs font-medium"
          onClick={() => {
            if (ref.current) fitProviderBounds(ref.current, bounds);
          }}
        >
          Show all providers
        </button>
      </div>

      {tileError ? (
        <p
          className="border-b border-[var(--color-border)] bg-[var(--color-warn-bg)] px-3 py-2 text-xs text-[var(--color-warn)]"
          role="alert"
        >
          The base map tiles are not loading. Provider markers may still be available; check your
          connection or use the list view.
        </p>
      ) : null}

      <div className="min-h-0 flex-1">
        <MapContainer
          bounds={bounds}
          boundsOptions={{ maxZoom: 14, padding: [32, 32] }}
          ref={ref}
          style={{ height: "100%", width: "100%" }}
          scrollWheelZoom
          keyboard
          keyboardPanDelta={80}
        >
          {/* Public OpenStreetMap tiles are a convenient local-development
              default. Production can select its tile service without a code
              change through NEXT_PUBLIC_MAP_TILE_URL and attribution. */}
          <TileLayer
            attribution={TILE_ATTRIBUTION}
            url={TILE_URL}
            eventHandlers={{
              load: () => setTileError(false),
              tileerror: () => setTileError(true),
            }}
          />
          <FitProviderBounds bounds={bounds} />
          <MapAccessibility labelId={labelId} instructionsId={instructionsId} />
          <Clusters providers={validProviders} />
        </MapContainer>
      </div>
    </section>
  );
}
