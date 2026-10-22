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
import { getImageProps } from "next/image";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { ArrowUpRight, LocateFixed, MapPinned } from "lucide-react";
import "leaflet/dist/leaflet.css";

import { Button } from "@/components/ui/button";
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
  const size = count < 10 ? 42 : count < 50 ? 46 : 52;
  return L.divIcon({
    html: `<div aria-hidden="true" style="width:${size}px;height:${size}px;border-radius:50%;background:var(--color-primary);color:#fff;display:flex;align-items:center;justify-content:center;font:700 13px/1 system-ui;border:3px solid #fff;box-shadow:0 5px 15px rgba(20,24,31,.28)">${count}</div>`,
    className: "",
    iconSize: [size, size],
  });
}

/** For a provider with no picture at all: the plain brand dot. */
const dotIcon = L.divIcon({
  html: `<div aria-hidden="true" style="width:42px;height:42px;display:grid;place-items:center"><div style="width:22px;height:22px;border-radius:50%;background:var(--color-brand-strong);border:3px solid #fff;box-shadow:0 4px 12px rgba(20,24,31,.35)"></div></div>`,
  className: "",
  iconSize: [42, 42],
  iconAnchor: [21, 21],
});

const PHOTO_PIN = 44;

function escapeAttribute(value: string) {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

/**
 * Screen 2's photo pin: the workshop itself rather than a coloured dot, since
 * the thing being judged is a workshop. Falls back to the owner's logo, then
 * to the dot.
 *
 * The image goes through Next's optimiser at pin size, the same route
 * next/image uses, so a pin costs a few kilobytes of WebP rather than the
 * stored original — Section 10's page-weight budget applies to the map too.
 * Built as an HTML string because Leaflet markers are DOM it owns, not React.
 */
function photoIcon(src: string, fit: "cover" | "contain") {
  const { srcSet, src: fallback } = getImageProps({
    src,
    alt: "",
    width: PHOTO_PIN,
    height: PHOTO_PIN,
  }).props;
  const inner = PHOTO_PIN - 6;
  const background = fit === "contain" ? "#fff" : "var(--color-muted)";
  const padding = fit === "contain" ? "padding:4px;" : "";
  return L.divIcon({
    html:
      `<div aria-hidden="true" style="position:relative;width:${PHOTO_PIN}px;height:${PHOTO_PIN + 8}px">` +
      `<div style="width:${PHOTO_PIN}px;height:${PHOTO_PIN}px;border-radius:12px;border:3px solid #fff;background:${background};box-shadow:0 5px 14px rgba(20,24,31,.35);overflow:hidden">` +
      `<img src="${escapeAttribute(fallback)}"${
        srcSet ? ` srcset="${escapeAttribute(srcSet)}"` : ""
      } alt="" width="${inner}" height="${inner}" loading="lazy" decoding="async" ` +
      `style="display:block;width:100%;height:100%;object-fit:${fit};${padding}box-sizing:border-box">` +
      `</div>` +
      // The tail, so the pin points at the workshop rather than covering it.
      `<div style="position:absolute;left:50%;bottom:1px;width:12px;height:12px;margin-left:-6px;background:#fff;transform:rotate(45deg);box-shadow:3px 3px 6px rgba(20,24,31,.18)"></div>` +
      `</div>`,
    className: "",
    iconSize: [PHOTO_PIN, PHOTO_PIN + 8],
    iconAnchor: [PHOTO_PIN / 2, PHOTO_PIN + 6],
    popupAnchor: [0, -(PHOTO_PIN + 2)],
  });
}

/**
 * One icon per picture, reused across renders. Handing react-leaflet a new
 * icon object makes it rebuild the marker's DOM, which re-requests the image
 * and flickers every pin on every pan.
 */
const pinCache = new Map<string, L.DivIcon>();

function pinIcon(provider: ProviderCard) {
  const picture = provider.primary_photo ?? provider.logo;
  if (!picture) return dotIcon;
  const fit = provider.primary_photo ? "cover" : "contain";
  const key = `${fit}:${picture}`;
  let icon = pinCache.get(key);
  if (!icon) {
    icon = photoIcon(picture, fit);
    pinCache.set(key, icon);
  }
  return icon;
}

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
  const t = useTranslations("MapView");
  const tFormat = useTranslations("Format");

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
              title={t("clusterTitle", { count })}
              alt={t("clusterAlt", { count })}
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
            icon={pinIcon(provider)}
            keyboard
            riseOnHover
            title={t("pinTitle", { name: provider.name })}
            alt={t("pinAlt", { name: provider.name })}
          >
            {/* Selecting a pin raises the same comparison the list supports. */}
            <Popup>
              <strong className="block max-w-52 text-sm leading-5 text-[var(--color-foreground)]">
                {provider.name}
              </strong>
              <span className="mt-1 block text-xs font-medium text-[var(--color-muted-foreground)]">
                {provider.area} · {formatFee(provider.lowest_fee, tFormat)}
              </span>
              <span className="mt-1 block text-xs text-[var(--color-muted-foreground)]">
                {provider.site_visit ? t("visitedBy", { brand: BRAND }) : t("notVisited")}
              </span>
              <Link
                href={`/${provider.area_slug}/${provider.slug}`}
                className="mt-3 inline-flex min-h-11 items-center gap-1.5 rounded-lg bg-[var(--color-primary)] px-3 text-xs font-semibold text-[var(--color-primary-foreground)]"
              >
                {t("seeDetails")} <ArrowUpRight className="size-3.5" aria-hidden="true" />
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
  immersive = false,
  scopeLabel,
}: {
  providers: ProviderCard[];
  /** Fill the parent's height instead of a fixed viewport fraction. Used by the
      search-page side panel, which is already height-constrained. */
  fillParent?: boolean;
  /**
   * Float the chrome over the map instead of stacking it above.
   *
   * For the full-screen map on a phone. The bar costs about 90px of a 812px
   * screen, and on a screen that is meant to be all map that is the difference
   * between a map and a panel with a map in it. The same controls are still
   * there, as pills sitting on the tiles.
   */
  immersive?: boolean;
  /** Clarifies when a side map contains only the current paginated list. */
  scopeLabel?: string;
}) {
  const t = useTranslations("MapView");
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
          <span className="mx-auto grid size-11 place-items-center rounded-xl border border-[var(--color-border)] bg-[var(--color-card)] text-[var(--color-muted-foreground)] shadow-sm">
            <MapPinned className="size-5" aria-hidden="true" />
          </span>
          <h2 className="mt-3 text-base font-semibold">{t("noLocationsTitle")}</h2>
          <p className="mt-2 text-sm text-[var(--color-muted-foreground)]">
            {t("noLocationsBody")}
          </p>
        </div>
      </div>
    );
  }

  return (
    <section
      className={`relative flex min-h-0 flex-col bg-[var(--color-card)]${
        immersive ? " map-immersive" : ""
      }`}
      style={{ height: fillParent ? "100%" : "70dvh" }}
      data-provider-map
    >
      {/* Immersive means "float below lg, ordinary bar from lg" — expressed in
          CSS rather than a JS branch, because this is a Server-rendered page
          and the viewport is not knowable at render time. Reading the width in
          JS would either flash the wrong chrome or mismatch on hydration. */}
      <div
        className={
          immersive
            ? // z-[500] clears Leaflet's own panes, which sit at 400 and below.
              "pointer-events-none absolute inset-x-0 top-0 z-[500] flex items-start justify-between gap-2 p-3 lg:pointer-events-auto lg:static lg:grid lg:grid-cols-[minmax(0,1fr)_auto] lg:items-start lg:gap-2 lg:gap-x-3 lg:border-b lg:border-[var(--color-border)] lg:bg-[var(--color-card)]/95 lg:p-0 lg:px-4 lg:py-3"
            : "grid gap-2 border-b border-[var(--color-border)] bg-[var(--color-card)]/95 px-4 py-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start sm:gap-x-3"
        }
      >
        <div
          className={
            immersive
              ? "pointer-events-auto flex min-w-0 items-center gap-2 rounded-full bg-[var(--color-card)]/90 px-3 py-2 shadow-[var(--shadow-lg)] backdrop-blur-sm lg:items-start lg:gap-2.5 lg:rounded-none lg:bg-transparent lg:p-0 lg:shadow-none lg:backdrop-blur-none"
              : "flex min-w-0 items-start gap-2.5"
          }
        >
          <span
            className={
              immersive
                ? "grid size-6 shrink-0 place-items-center rounded-full bg-[var(--color-brand-soft)] text-[var(--color-brand-strong)] lg:mt-0.5 lg:size-8 lg:rounded-lg"
                : "mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg bg-[var(--color-brand-soft)] text-[var(--color-brand-strong)]"
            }
          >
            <MapPinned
              className={immersive ? "size-3.5 lg:size-4" : "size-4"}
              aria-hidden="true"
            />
          </span>
          <div className={immersive ? "min-w-0 lg:pt-1" : "min-w-0 pt-1"}>
            <h2
              id={labelId}
              className="truncate text-xs font-bold text-[var(--color-foreground)] sm:text-sm"
            >
              {/* The full-screen phone map has room for the count only. */}
              {immersive ? (
                <span className="lg:hidden">
                  {t("providerCount", { count: validProviders.length })}
                </span>
              ) : null}
              <span className={immersive ? "hidden lg:inline" : undefined}>
                {t("interactiveMap", { count: validProviders.length })}
              </span>
              {scopeLabel ? (
                <span className={immersive ? "hidden lg:inline" : undefined}>{` ${scopeLabel}`}</span>
              ) : null}
            </h2>
          </div>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className={
            immersive
              ? "pointer-events-auto min-h-11 shrink-0 rounded-full shadow-[var(--shadow-lg)] backdrop-blur-sm lg:rounded-lg lg:shadow-none lg:backdrop-blur-none"
              : "min-h-11 shrink-0"
          }
          onClick={() => {
            if (ref.current) fitProviderBounds(ref.current, bounds);
          }}
        >
          <LocateFixed aria-hidden="true" />
          {immersive ? (
            <>
              <span className="sr-only lg:hidden">{t("showAll")}</span>
              <span className="hidden lg:inline">{t("showAll")}</span>
            </>
          ) : (
            t("showAll")
          )}
        </Button>
        {/* Keyboard help. Always in the DOM because aria-describedby on the map
            points at it; hidden visually on the full-screen phone map, where
            the whole point is an uncluttered screen and there are no arrow
            keys to press anyway. */}
        <p
          id={instructionsId}
          className={
            immersive
              ? "sr-only lg:not-sr-only lg:col-span-2 lg:text-[11px] lg:leading-4 lg:text-[var(--color-muted-foreground)]"
              : "text-[11px] leading-4 text-[var(--color-muted-foreground)] sm:col-span-2"
          }
        >
          {t("keyboardHelp")}
        </p>
      </div>

      {tileError ? (
        <p
          className="border-b border-[var(--color-border)] bg-[var(--color-warn-bg)] px-3 py-2 text-xs text-[var(--color-warn)]"
          role="alert"
        >
          {t("tilesFailed")}
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
