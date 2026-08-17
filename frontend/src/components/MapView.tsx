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

import { useMemo, useRef, useState } from "react";
import { MapContainer, Marker, Popup, TileLayer, useMap, useMapEvents } from "react-leaflet";
import Supercluster from "supercluster";
import L from "leaflet";
import Link from "next/link";
import "leaflet/dist/leaflet.css";

import { BRAND } from "@/lib/brand";
import { formatFee } from "@/lib/format";
import type { ProviderCard } from "@/lib/types";

const ACCRA: [number, number] = [5.6037, -0.187];

function clusterIcon(count: number) {
  const size = count < 10 ? 34 : count < 50 ? 42 : 50;
  return L.divIcon({
    html: `<div style="width:${size}px;height:${size}px;border-radius:50%;background:#14181f;color:#fff;display:flex;align-items:center;justify-content:center;font:600 13px/1 system-ui;border:2px solid #fff">${count}</div>`,
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
              eventHandlers={{
                click: () => map.setView([lat, lng], index.getClusterExpansionZoom(item.id as number)),
              }}
            />
          );
        }

        const provider = (item.properties as ClusterPoint["properties"]).provider;
        return (
          <Marker key={provider.id} position={[lat, lng]} icon={pinIcon}>
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

  return (
    <MapContainer
      center={ACCRA}
      zoom={11}
      ref={ref}
      style={{ height: fillParent ? "100%" : "70dvh", width: "100%" }}
      scrollWheelZoom
    >
      {/*
        OpenStreetMap's public tile server prohibits this kind of use, so a
        tile provider must be chosen before launch. The Leaflet code does not
        change when it is — only this URL and its attribution.
      */}
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      <Clusters providers={providers} />
    </MapContainer>
  );
}
