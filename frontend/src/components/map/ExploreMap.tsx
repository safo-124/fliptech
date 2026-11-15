"use client";

/**
 * The full-screen map page: the map is the whole screen, and the workshops
 * float over it.
 *
 * From lg, a glass panel down the left lists every workshop; on a phone the
 * same cards become a row to swipe along the bottom. Picking a card flies the
 * map to that workshop and enlarges its pin; picking a pin brings its card
 * into view. One list, one selection, laid out two ways in CSS, because this
 * renders once for both widths and the viewport is not known on the server.
 *
 * Loaded with `dynamic(..., { ssr: false })` from MapLoader: Leaflet touches
 * `window` at import time.
 */

import { useCallback, useEffect, useId, useMemo, useState } from "react";
import {
  CircleMarker,
  MapContainer,
  Marker,
  TileLayer,
  useMap,
  useMapEvents,
} from "react-leaflet";
import Supercluster from "supercluster";
import L from "leaflet";
import Link from "next/link";
import { useTranslations } from "next-intl";
import {
  AlertTriangle,
  ArrowUpRight,
  BadgeCheck,
  Clock,
  List,
  LocateFixed,
  MapPin,
  Minus,
  Navigation,
  Plus,
} from "lucide-react";
import "leaflet/dist/leaflet.css";

import { TradeChip } from "@/components/TradeChip";
import { BRAND } from "@/lib/brand";
import { formatDuration, formatFee } from "@/lib/format";
import type { ExploreProvider } from "@/lib/map-provider";
import { softTilesClass, TILE_ATTRIBUTION, TILE_URL } from "@/lib/map-tiles";

import {
  hasValidCoordinates,
  MapAccessibility,
  viewportOf,
  type Viewport,
} from "../MapView";
import { clusterIcon, pinIcon } from "./pins";

type Props = { cluster: false; provider: ExploreProvider };

/** Close enough that two workshops on one street come apart. */
const FOCUS_ZOOM = 16;

/**
 * Fit the workshops into the part of the map that is not under the floating
 * panel (lg) or the row of cards and the buttons (phone). Only ever called in
 * the browser: this component is loaded with ssr: false.
 */
function fitOptions(): L.FitBoundsOptions {
  const wide = window.matchMedia("(min-width: 64rem)").matches;
  return wide
    ? { maxZoom: 14, paddingTopLeft: [440, 96], paddingBottomRight: [96, 64] }
    : { maxZoom: 14, paddingTopLeft: [32, 88], paddingBottomRight: [32, 190] };
}

function cardId(base: string, provider: ExploreProvider) {
  return `${base}-card-${provider.id}`;
}

function Pins({
  providers,
  selected,
  onSelect,
}: {
  providers: ExploreProvider[];
  selected: number | null;
  onSelect: (provider: ExploreProvider) => void;
}) {
  const map = useMap();
  const t = useTranslations("MapView");
  const [viewport, setViewport] = useState<Viewport>(() => viewportOf(map));
  useMapEvents({ moveend: () => setViewport(viewportOf(map)) });

  const index = useMemo(() => {
    const cluster = new Supercluster<Props>({ radius: 60, maxZoom: FOCUS_ZOOM - 1 });
    cluster.load(
      providers.map((provider) => ({
        type: "Feature" as const,
        properties: { cluster: false as const, provider },
        geometry: { type: "Point" as const, coordinates: [provider.lng, provider.lat] },
      })),
    );
    return cluster;
  }, [providers]);

  const items = useMemo(
    () => index.getClusters(viewport.bounds, Math.round(viewport.zoom)),
    [index, viewport],
  );

  return (
    <>
      {items.map((item) => {
        const [lng, lat] = item.geometry.coordinates;
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
                click: () =>
                  map.flyTo([lat, lng], index.getClusterExpansionZoom(item.id as number), {
                    duration: 0.6,
                  }),
              }}
            />
          );
        }
        const provider = (item.properties as Props).provider;
        const active = provider.id === selected;
        return (
          <Marker
            key={provider.id}
            position={[lat, lng]}
            icon={pinIcon(provider, active)}
            zIndexOffset={active ? 1000 : 0}
            keyboard
            riseOnHover
            title={t("pinTitle", { name: provider.name })}
            alt={t("pinAlt", { name: provider.name })}
            eventHandlers={{ click: () => onSelect(provider) }}
          />
        );
      })}
    </>
  );
}

/** Leaflet's own map, handed up once it exists, for the controls outside it. */
function Capture({ onMap }: { onMap: (map: L.Map) => void }) {
  const map = useMap();
  useEffect(() => onMap(map), [map, onMap]);
  return null;
}

/** Escape lets go of the chosen workshop, as it closes a popup elsewhere. */
function EscapeToClear({ onClear }: { onClear: () => void }) {
  const map = useMap();
  useEffect(() => {
    const container = map.getContainer();
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && onClear();
    container.addEventListener("keydown", onKey);
    return () => container.removeEventListener("keydown", onKey);
  }, [map, onClear]);
  return null;
}

const roundButton =
  "pointer-events-auto grid size-11 place-items-center rounded-full border border-white/70 bg-white/90 text-[var(--color-foreground)] shadow-[0_8px_24px_-8px_rgb(38_0_90/0.35)] backdrop-blur-md transition hover:bg-white hover:text-[var(--color-brand-strong)] disabled:opacity-60";

export default function ExploreMap({
  providers,
  listHref,
  missingCount = 0,
}: {
  providers: ExploreProvider[];
  listHref: string;
  /** Workshops that could not be plotted, said once in the panel. */
  missingCount?: number;
}) {
  const t = useTranslations("MapView");
  const tFormat = useTranslations("Format");
  const base = useId();
  const labelId = useId();
  const instructionsId = useId();
  const [map, setMap] = useState<L.Map | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [tileError, setTileError] = useState(false);
  const [me, setMe] = useState<[number, number] | null>(null);
  const [locating, setLocating] = useState(false);
  const [locateFailed, setLocateFailed] = useState(false);

  const valid = useMemo(() => providers.filter(hasValidCoordinates), [providers]);
  const bounds = useMemo(
    () => L.latLngBounds(valid.map((provider) => [provider.lat, provider.lng])),
    [valid],
  );

  const showAll = useCallback(() => {
    map?.flyToBounds(bounds, { ...fitOptions(), duration: 0.8 });
  }, [map, bounds]);

  /** From a card: fly there. */
  const focus = useCallback(
    (provider: ExploreProvider) => {
      setSelected(provider.id);
      map?.flyTo([provider.lat, provider.lng], Math.max(map.getZoom(), FOCUS_ZOOM), {
        duration: 0.8,
      });
    },
    [map],
  );

  /** From a pin: bring its card into view. */
  const pick = useCallback(
    (provider: ExploreProvider) => {
      setSelected(provider.id);
      document
        .getElementById(cardId(base, provider))
        ?.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
    },
    [base],
  );

  const clear = useCallback(() => setSelected(null), []);

  function locate() {
    if (!navigator.geolocation) {
      setLocateFailed(true);
      return;
    }
    setLocating(true);
    setLocateFailed(false);
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        setLocating(false);
        const here: [number, number] = [coords.latitude, coords.longitude];
        setMe(here);
        map?.flyTo(here, Math.max(map.getZoom(), 13), { duration: 0.8 });
      },
      () => {
        setLocating(false);
        setLocateFailed(true);
      },
      { enableHighAccuracy: false, timeout: 10_000, maximumAge: 300_000 },
    );
  }

  return (
    <section className="explore-map relative h-full w-full overflow-hidden" data-provider-map>
      <p id={labelId} className="sr-only">
        {t("interactiveMap", { count: valid.length })}
      </p>
      <p id={instructionsId} className="sr-only">
        {t("keyboardHelp")}
      </p>

      <MapContainer
        bounds={bounds}
        boundsOptions={fitOptions()}
        className={`h-full w-full ${softTilesClass()}`}
        zoomControl={false}
        scrollWheelZoom
        keyboard
        keyboardPanDelta={80}
      >
        <TileLayer
          attribution={TILE_ATTRIBUTION}
          url={TILE_URL}
          eventHandlers={{
            load: () => setTileError(false),
            tileerror: () => setTileError(true),
          }}
        />
        <Capture onMap={setMap} />
        <MapAccessibility labelId={labelId} instructionsId={instructionsId} />
        <EscapeToClear onClear={clear} />
        {me ? (
          <>
            <CircleMarker
              center={me}
              radius={18}
              interactive={false}
              pathOptions={{ stroke: false, fillColor: "#2563eb", fillOpacity: 0.18 }}
            />
            <CircleMarker
              center={me}
              radius={7}
              interactive={false}
              pathOptions={{ color: "#fff", weight: 3, fillColor: "#2563eb", fillOpacity: 1 }}
            />
          </>
        ) : null}
        <Pins providers={valid} selected={selected} onSelect={pick} />
      </MapContainer>

      {/* Soft fades at the top and the bottom, so the floating controls and
          cards sit on calm ground rather than straight on busy streets. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 z-[450] h-28 bg-gradient-to-b from-[oklch(0.97_0.015_300/0.85)] to-transparent"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 bottom-0 z-[450] h-48 bg-gradient-to-t from-[oklch(0.97_0.015_300/0.9)] to-transparent lg:hidden"
      />

      {/* Top left on a phone: how many, where the panel's heading is on lg. */}
      <p className="pointer-events-none absolute left-3 top-3 z-[600] inline-flex min-h-11 items-center gap-2 rounded-full border border-white/70 bg-white/90 px-3.5 text-sm font-bold shadow-[0_8px_24px_-8px_rgb(38_0_90/0.35)] backdrop-blur-md lg:hidden">
        <span className="grid size-6 place-items-center rounded-full bg-[var(--color-brand-strong)] text-white">
          <MapPin aria-hidden="true" className="size-3.5" />
        </span>
        {t("providerCount", { count: valid.length })}
      </p>

      {/* Top right: back to the list, show everything, and where am I. */}
      <div className="pointer-events-none absolute right-3 top-3 z-[600] flex items-center gap-2 lg:right-5 lg:top-5">
        <Link
          href={listHref}
          className="pointer-events-auto inline-flex min-h-11 items-center gap-2 rounded-full border border-white/70 bg-white/90 px-4 text-sm font-semibold shadow-[0_8px_24px_-8px_rgb(38_0_90/0.35)] backdrop-blur-md transition hover:bg-white hover:text-[var(--color-brand-strong)]"
        >
          <List aria-hidden="true" className="size-4" />
          {t("listView")}
        </Link>
        <button type="button" onClick={showAll} className={roundButton}>
          <LocateFixed aria-hidden="true" className="size-[1.125rem]" />
          <span className="sr-only">{t("showAll")}</span>
        </button>
        <button
          type="button"
          onClick={locate}
          disabled={locating}
          aria-label={t("nearMe")}
          className={roundButton}
        >
          <Navigation
            aria-hidden="true"
            className={`size-[1.125rem] ${locating ? "animate-pulse" : ""} ${me ? "fill-[#2563eb] text-[#2563eb]" : ""}`}
          />
        </button>
      </div>

      {/* Bottom right from lg: zoom. On a phone, pinch does it. */}
      <div className="absolute bottom-8 right-5 z-[600] hidden flex-col overflow-hidden rounded-2xl border border-white/70 bg-white/90 shadow-[0_8px_24px_-8px_rgb(38_0_90/0.35)] backdrop-blur-md lg:flex">
        <button
          type="button"
          aria-label={t("zoomIn")}
          onClick={() => map?.zoomIn()}
          className="grid size-11 place-items-center transition hover:bg-[var(--color-brand-soft)] hover:text-[var(--color-brand-strong)]"
        >
          <Plus aria-hidden="true" className="size-[1.125rem]" />
        </button>
        <span aria-hidden="true" className="mx-2.5 h-px bg-[var(--color-border)]" />
        <button
          type="button"
          aria-label={t("zoomOut")}
          onClick={() => map?.zoomOut()}
          className="grid size-11 place-items-center transition hover:bg-[var(--color-brand-soft)] hover:text-[var(--color-brand-strong)]"
        >
          <Minus aria-hidden="true" className="size-[1.125rem]" />
        </button>
      </div>

      {tileError || locateFailed ? (
        <p
          role="alert"
          className="absolute left-1/2 top-[4.25rem] z-[600] flex w-[min(28rem,calc(100%-1.5rem))] -translate-x-1/2 items-start gap-2 rounded-2xl bg-[var(--color-warn-bg)] px-3.5 py-2.5 text-xs leading-5 text-[var(--color-warn)] shadow-[var(--shadow-lg)] lg:top-5 lg:left-[calc(50%+12rem)] lg:w-[24rem]"
        >
          <AlertTriangle aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          {tileError ? t("tilesFailed") : t("nearMeFailed")}
        </p>
      ) : null}

      {/* The workshops: a swipeable row on a phone, a side panel from lg. */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-[600] lg:bottom-5 lg:left-5 lg:right-auto lg:top-5 lg:w-[23.5rem]">
        <div className="pointer-events-auto flex h-full flex-col lg:overflow-hidden lg:rounded-3xl lg:border lg:border-white/70 lg:bg-white/85 lg:shadow-[0_30px_80px_-30px_rgb(38_0_90/0.45)] lg:backdrop-blur-xl">
          <div className="hidden px-5 pb-3 pt-5 lg:block">
            <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-[var(--color-brand-strong)]">
              {t("panelEyebrow")}
            </p>
            <h2 className="mt-1 text-xl font-bold tracking-[-0.02em]">
              {t("panelTitle", { count: valid.length })}
            </h2>
            <p className="mt-1 text-sm leading-5 text-[var(--color-muted-foreground)]">
              {t("panelLead")}
            </p>
            {missingCount > 0 ? (
              <p className="mt-2 text-xs text-[var(--color-warn)]">
                {t("panelMissing", { count: missingCount })}
              </p>
            ) : null}
          </div>

          <ul
            aria-label={t("panelTitle", { count: valid.length })}
            className="flex snap-x snap-mandatory gap-3 overflow-x-auto px-3 pb-6 pt-2 [scrollbar-width:none] lg:min-h-0 lg:flex-1 lg:snap-none lg:flex-col lg:gap-2 lg:overflow-y-auto lg:overflow-x-hidden lg:px-3 lg:pb-3 lg:pt-0 lg:[scrollbar-width:thin]"
          >
            {valid.map((provider) => {
              const active = provider.id === selected;
              const href = `/${provider.area_slug}/${provider.slug}`;
              const picture = provider.primary_photo ?? provider.logo;
              return (
                <li
                  key={provider.id}
                  id={cardId(base, provider)}
                  className="w-[min(20rem,82vw)] shrink-0 snap-center lg:w-auto"
                >
                  <article
                    className={`group relative flex gap-3 rounded-2xl border p-2.5 transition ${
                      active
                        ? "border-[var(--color-brand)] bg-white shadow-[0_12px_32px_-14px_rgb(59_7_100/0.55)] ring-2 ring-[var(--color-brand)]/20"
                        : "border-white/80 bg-white/95 shadow-[0_10px_30px_-16px_rgb(38_0_90/0.45)] hover:border-[var(--color-brand)]/30 lg:border-transparent lg:bg-transparent lg:shadow-none lg:hover:bg-white/80"
                    }`}
                  >
                    <span className="relative size-[4.5rem] shrink-0 overflow-hidden rounded-xl bg-[var(--color-brand-soft)]">
                      {picture ? (
                        // eslint-disable-next-line @next/next/no-img-element -- a small thumbnail; the pins already pull this through the optimiser
                        <img
                          src={picture}
                          alt=""
                          loading="lazy"
                          decoding="async"
                          className={`size-full ${provider.primary_photo ? "object-cover" : "object-contain p-2"}`}
                        />
                      ) : (
                        <span className="grid size-full place-items-center text-[var(--color-brand-strong)]">
                          <MapPin aria-hidden="true" className="size-6" />
                        </span>
                      )}
                    </span>
                    <div className="min-w-0 flex-1">
                      <h3 className="truncate pr-8 text-sm font-bold leading-5">
                        {/* The whole card picks the workshop; the arrow opens it. */}
                        <button
                          type="button"
                          onClick={() => focus(provider)}
                          aria-pressed={active}
                          className="text-left after:absolute after:inset-0 after:rounded-2xl after:content-['']"
                        >
                          {provider.name}
                        </button>
                      </h3>
                      <p className="mt-0.5 flex items-center gap-1 truncate text-xs text-[var(--color-muted-foreground)]">
                        <MapPin aria-hidden="true" className="size-3 shrink-0" />
                        <span className="truncate">{provider.area}</span>
                        {provider.site_visit ? (
                          <span
                            title={t("visitedBy", { brand: BRAND })}
                            className="ml-1 inline-flex items-center gap-0.5 text-emerald-700"
                          >
                            <BadgeCheck aria-hidden="true" className="size-3.5" />
                            <span className="sr-only">{t("visitedBy", { brand: BRAND })}</span>
                          </span>
                        ) : null}
                      </p>
                      <div className="mt-1.5 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs">
                        <b className="font-bold text-[var(--color-foreground)]">
                          {formatFee(provider.lowest_fee, tFormat)}
                        </b>
                        {provider.shortest_duration_weeks !== null ? (
                          <span className="inline-flex items-center gap-1 text-[var(--color-muted-foreground)]">
                            <Clock aria-hidden="true" className="size-3" />
                            {formatDuration(provider.shortest_duration_weeks, tFormat)}
                          </span>
                        ) : null}
                        {provider.trade ? (
                          <TradeChip
                            name={provider.trade.name}
                            colour={provider.trade.colour}
                            className="!py-0 text-[11px]"
                          />
                        ) : null}
                      </div>
                    </div>
                    <Link
                      href={href}
                      aria-label={t("openWorkshop", { name: provider.name })}
                      className="relative z-10 grid size-8 shrink-0 place-items-center self-start rounded-full bg-[var(--color-brand-soft)] text-[var(--color-brand-strong)] transition hover:bg-[var(--color-brand-strong)] hover:text-white"
                    >
                      <ArrowUpRight aria-hidden="true" className="size-4" />
                    </Link>
                  </article>
                </li>
              );
            })}
          </ul>
        </div>
      </div>
    </section>
  );
}
