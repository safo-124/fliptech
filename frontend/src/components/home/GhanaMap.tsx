import {GHANA, insideGhana} from "@/lib/ghana-bounds";

/**
 * A small outline of Ghana with a dot for each workshop, for the home page's
 * Find training tile. Decoration that is also true: the dots are the real
 * listings' pins, so the map fills in as the country does.
 *
 * The outline is a simplified trace of the border (forty points), enough to
 * read as Ghana at this size and no more.
 */
const OUTLINE: [number, number][] = [
  [5.1, -3.1], [4.87, -2.24], [4.74, -2.09], [4.89, -1.75], [5.1, -1.25], [5.35, -0.62], [5.53, -0.2],
  [5.62, 0.0], [5.78, 0.63], [5.92, 0.99], [6.1, 1.2], [6.6, 0.75], [7.0, 0.62], [7.4, 0.55],
  [7.9, 0.6], [8.3, 0.48], [8.8, 0.38], [9.2, 0.52], [9.6, 0.4], [10.0, 0.36], [10.5, 0.3],
  [10.95, 0.05], [11.13, -0.15], [11.0, -0.6], [10.97, -1.1], [11.0, -1.6], [11.1, -2.2],
  [11.0, -2.8], [10.6, -2.93], [10.0, -2.79], [9.6, -2.69], [9.1, -2.75], [8.6, -2.62],
  [8.0, -2.75], [7.5, -3.1], [7.0, -3.2], [6.6, -3.25], [6.2, -3.1], [5.6, -2.95], [5.2, -3.15],
];

const WIDTH = 220;
const HEIGHT = 260;

function project(lat: number, lng: number): [number, number] {
  const x = ((lng - GHANA.west) / (GHANA.east - GHANA.west)) * WIDTH;
  const y = ((GHANA.north - lat) / (GHANA.north - GHANA.south)) * HEIGHT;
  return [Math.round(x * 10) / 10, Math.round(y * 10) / 10];
}

export function GhanaMap({pins, className = ""}: {pins: {lat: number; lng: number}[]; className?: string}) {
  const outline = OUTLINE.map(([lat, lng]) => project(lat, lng).join(",")).join(" ");
  const dots = pins.filter((pin) => insideGhana(pin.lat, pin.lng)).map((pin) => project(pin.lat, pin.lng));

  return (
    <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} aria-hidden="true" className={className}>
      <polygon
        points={outline}
        fill="var(--color-card)"
        stroke="var(--color-brand)"
        strokeOpacity="0.3"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      {dots.map(([x, y], index) => (
        <g key={index}>
          <circle cx={x} cy={y} r="9" fill="var(--color-brand)" opacity="0.14" />
          <circle cx={x} cy={y} r="4" fill="var(--color-brand)" />
        </g>
      ))}
    </svg>
  );
}
