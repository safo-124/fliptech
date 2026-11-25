import { getImageProps } from "next/image";

import type { MapPin } from "@/lib/types";

import { GEO } from "./geo";
import styles from "./GhanaMap.module.css";
import type { MapCard } from "./MapStage";
import { PLACES } from "./places";
import { daysSince, placePins } from "./pins";
import { MAP_HEIGHT, MAP_WIDTH, project } from "./project";

/** The pin's photo circle: its radius, and how far above the point it sits. */
const R = 14;
const LIFT = R + 7;
/** A workshop this new gets the soft pulse. */
const NEW_DAYS = 14;

/** Pale tints of the brand colour, so neighbouring regions read apart. */
const TINTS = ["oklch(0.968 0.016 300)", "oklch(0.948 0.026 298)", "oklch(0.932 0.034 296)"];

export type GhanaMapLabels = {
  label: string;
  sea: string;
  lake: string;
  regionTip: (region: string, count: number) => string;
  pinLabel: (pin: MapPin) => string;
  groupLabel: (count: number, place: string) => string;
};

/** A photo small enough for a pin, through Next's image optimiser. */
function thumb(url: string, width: number): string {
  return getImageProps({ src: url, alt: "", width, height: width, quality: 70 }).props.src;
}

export function pinCard(pin: MapPin, now: Date): MapCard {
  return {
    name: pin.name,
    meta: [pin.trade?.name, `${pin.area}, ${pin.region}`].filter(Boolean).join(" · "),
    photo: pin.primary_photo ? thumb(pin.primary_photo, 320) : null,
    shop: pin.has_shop,
    href: `/${pin.area_slug}/${pin.slug}`,
    fresh: daysSince(pin.joined, now) <= NEW_DAYS,
  };
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter((word) => /^[\p{L}\p{N}]/u.test(word))
    .slice(0, 2)
    .map((word) => word[0].toUpperCase())
    .join("");
}

/**
 * Ghana's sixteen regions with a pin for every listed workshop, drawn on the
 * server as plain SVG: no map library, no tiles, and the regions and pins
 * are ordinary links, so the map works with no JavaScript at all. MapStage
 * adds the hover cards on top.
 */
export function GhanaMap({
  pins,
  regionCounts,
  labels,
  now,
}: {
  pins: MapPin[];
  regionCounts: Map<string, number>;
  labels: GhanaMapLabels;
  now: Date;
}) {
  const placed = placePins(pins);
  const allRegions = GEO.regions.map((region) => region.d).join("");
  const seaTop = project(5.6, 0)[1];

  return (
    <svg
      viewBox={`0 0 ${MAP_WIDTH} ${MAP_HEIGHT + 22}`}
      role="img"
      aria-label={labels.label}
      className={styles.svg}
    >
      <defs>
        <pattern id="gm-sea" width="9" height="9" patternUnits="userSpaceOnUse">
          <circle cx="1" cy="1" r="0.8" fill="oklch(0.75 0.05 240)" />
        </pattern>
        <linearGradient id="gm-sea-fade" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fff" stopOpacity="0" />
          <stop offset="0.35" stopColor="#fff" stopOpacity="1" />
        </linearGradient>
        {/* Rivers run on past the border; only the part in Ghana is drawn. */}
        <clipPath id="gm-land">
          <path d={allRegions} />
        </clipPath>
        <mask id="gm-sea-mask">
          <rect x="0" y={seaTop} width={MAP_WIDTH} height={MAP_HEIGHT} fill="url(#gm-sea-fade)" />
        </mask>
        {placed.map((item) =>
          item.kind === "pin" ? (
            <clipPath key={item.pin.id} id={`gm-pin-${item.pin.id}`}>
              <circle cx="0" cy={-LIFT} r={R - 2} />
            </clipPath>
          ) : null,
        )}
      </defs>

      {/* The sea, fading in below the coast. */}
      <rect x="0" y={seaTop} width={MAP_WIDTH} height={MAP_HEIGHT} fill="url(#gm-sea)" mask="url(#gm-sea-mask)" opacity="0.6" />
      <text x={MAP_WIDTH / 2} y={MAP_HEIGHT + 12} className={styles.sea}>
        {labels.sea}
      </text>

      {/* A soft shadow, then each region as a link to its workshops. */}
      <path d={allRegions} fill="oklch(0.4 0.2 293 / 0.1)" transform="translate(0,4)" />
      {GEO.regions.map((region, index) => {
        const tip = labels.regionTip(region.name, regionCounts.get(region.slug) ?? 0);
        return (
          <a key={region.slug} href={`/training?region=${region.slug}`} aria-label={tip} data-tip={tip}>
            <path d={region.d} fill={TINTS[index % TINTS.length]} className={styles.region} data-region={region.slug} />
          </a>
        );
      })}
      <path d={allRegions} className={styles.borders} />

      {/* Water. */}
      <g clipPath="url(#gm-land)">
        {GEO.rivers.map((d, index) => (
          <path key={index} d={d} className={styles.river} />
        ))}
        {GEO.lakes.map((d, index) => (
          <path key={index} d={d} className={styles.lake} />
        ))}
      </g>
      <text {...xy(project(7.35, -0.32))} className={styles.lakeLabel}>
        {labels.lake}
      </text>

      {/* Region names. */}
      {GEO.regions.map((region) => (
        <text key={region.slug} x={region.label[0]} y={region.label[1]} className={styles.regionLabel}>
          {region.name.toUpperCase()}
        </text>
      ))}

      {/* Capitals and towns. */}
      {PLACES.map((place) => {
        const [x, y] = project(place.lat, place.lng);
        const gap = place.kind === "town" ? 5 : 7;
        const dx = place.side === "r" ? gap : place.side === "l" ? -gap : 0;
        const dy = place.side === "t" ? -gap : place.side === "b" ? gap + 8 : 3.5;
        const anchor = place.side === "r" ? "start" : place.side === "l" ? "end" : "middle";
        return (
          <g key={place.name} className={styles[place.kind]}>
            {place.kind === "capital" ? (
              <path d={star(x, y, 6)} className={styles.star} />
            ) : (
              <circle cx={x} cy={y} r={place.kind === "town" ? 1.8 : 2.6} className={styles.dot} />
            )}
            <text x={x + dx} y={y + dy} textAnchor={anchor} className={styles.placeLabel}>
              {place.name}
            </text>
          </g>
        );
      })}

      {/* The workshops. */}
      {placed.map((item) =>
        item.kind === "group" ? (
          <a
            key={`g-${item.pins[0].id}`}
            href={item.href}
            aria-label={labels.groupLabel(item.pins.length, item.place)}
            data-group={item.pins.map((pin) => pin.id).join(",")}
            data-place={item.place}
          >
            <g transform={`translate(${item.x},${item.y})`}>
              <g className={styles.pinBody}>
                <circle r={R + 5} className={styles.groupHalo} />
                <circle r={R + 1} className={styles.group} />
                <text y="4.5" className={styles.groupCount}>
                  {item.pins.length}
                </text>
              </g>
            </g>
          </a>
        ) : (
          <a
            key={item.pin.id}
            href={`/${item.pin.area_slug}/${item.pin.slug}`}
            aria-label={labels.pinLabel(item.pin)}
            data-pin={item.pin.id}
          >
            <g transform={`translate(${item.x},${item.y})`}>
              <g className={styles.pinBody}>
                <ellipse cx="0" cy="1" rx="6" ry="2" className={styles.pinShadow} />
                {daysSince(item.pin.joined, now) <= NEW_DAYS ? (
                  <circle cy={-LIFT} r={R} className={styles.pulse} />
                ) : null}
                <path d={`M-5,${-LIFT + R - 3}L0,0L5,${-LIFT + R - 3}Z`} className={styles.stem} />
                <circle cy={-LIFT} r={R} className={styles.ring} />
                {item.pin.primary_photo ? (
                  <image
                    href={thumb(item.pin.primary_photo, 64)}
                    x={-R}
                    y={-LIFT - R}
                    width={R * 2}
                    height={R * 2}
                    clipPath={`url(#gm-pin-${item.pin.id})`}
                    preserveAspectRatio="xMidYMid slice"
                  />
                ) : (
                  <>
                    <circle cy={-LIFT} r={R - 2} className={styles.initialsBg} />
                    <text y={-LIFT + 3.8} className={styles.initials}>
                      {initials(item.pin.name)}
                    </text>
                  </>
                )}
                {item.pin.has_shop ? (
                  <g transform={`translate(${R * 0.74},${-LIFT - R * 0.74})`}>
                    <circle r="6.5" className={styles.shopBadge} />
                    <path d="M-2.4,-1h4.8l-.5,3.4h-3.8z M-1.2,-1v-.8a1.2,1.2 0 0 1 2.4,0v.8" className={styles.shopBag} />
                  </g>
                ) : null}
              </g>
            </g>
          </a>
        ),
      )}
    </svg>
  );
}

function xy([x, y]: [number, number]) {
  return { x, y };
}

/** A five-pointed star for the national capital. */
export function star(x: number, y: number, r: number): string {
  const points = Array.from({ length: 10 }, (_, i) => {
    const angle = (Math.PI / 5) * i - Math.PI / 2;
    const radius = i % 2 ? r * 0.45 : r;
    return `${(x + radius * Math.cos(angle)).toFixed(1)},${(y + radius * Math.sin(angle)).toFixed(1)}`;
  });
  return `M${points.join("L")}Z`;
}
