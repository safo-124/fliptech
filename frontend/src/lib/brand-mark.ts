/**
 * The aperture mark's geometry, drawn once for every place it appears.
 *
 * BrandMark draws it in the header and footer with the theme's gradient
 * tokens; markSvg draws it as a standalone SVG for the favicon and the app
 * icons, where CSS variables do not exist. Both read the shape from here, so
 * the icon on a phone's home screen cannot drift from the logo on the page.
 */

import { BRAND_COLOURS } from "./brand";

const BLADE_COUNT = 12;

/** Inner and outer radius of a blade, and its half-width at each end. */
const INNER_RADIUS = 8.5;
const OUTER_RADIUS = 19;
const INNER_HALF_WIDTH = 1.9;
const OUTER_HALF_WIDTH = 3.6;

/**
 * Each blade is a tapered quadrilateral stroked in its own fill colour, which
 * is what rounds the corners — `stroke-linejoin: round` costs one attribute
 * where a hand-built rounded path would cost twelve arcs.
 */
export const BLADE_PATH = [
  `M ${-INNER_HALF_WIDTH} ${-INNER_RADIUS}`,
  `L ${-OUTER_HALF_WIDTH} ${-OUTER_RADIUS}`,
  `L ${OUTER_HALF_WIDTH} ${-OUTER_RADIUS}`,
  `L ${INNER_HALF_WIDTH} ${-INNER_RADIUS}`,
  "Z",
].join(" ");

/**
 * The rotation of each blade. The logo's ring is not quite closed: the blade
 * at the three-o'clock position is dropped and a dot sits in the gap.
 */
export const BLADE_ANGLES = Array.from(
  { length: BLADE_COUNT },
  (_, index) => (index * 360) / BLADE_COUNT,
).filter((_, index) => index !== 3);

export const MARK_DOT = { cx: OUTER_RADIUS - 5, r: 2.6 };

/** The mark as a complete SVG document, in hex colours, on a 48-unit grid. */
export function markSvg() {
  const { violet, orchid, pink } = BRAND_COLOURS;
  const blades = BLADE_ANGLES.map(
    (angle) =>
      `<path d="${BLADE_PATH}" transform="rotate(${angle})" stroke-width="1.6" stroke-linejoin="round"/>`,
  ).join("");
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48">` +
    `<defs><linearGradient id="g" x1="0" y1="1" x2="1" y2="0">` +
    `<stop offset="0%" stop-color="${violet}"/>` +
    `<stop offset="55%" stop-color="${orchid}"/>` +
    `<stop offset="100%" stop-color="${pink}"/>` +
    `</linearGradient></defs>` +
    `<g transform="translate(24 24)" fill="url(#g)" stroke="url(#g)">` +
    blades +
    `<circle cx="${MARK_DOT.cx}" cy="0" r="${MARK_DOT.r}"/>` +
    `</g></svg>`
  );
}
