/**
 * The Fliiptech mark's geometry, drawn once for every place it appears.
 *
 * Eight rounded petals in a ring that opens on the right, each a little smaller
 * than the last going clockwise from the left. Traced from the logo artwork
 * (Fliiptech_Skills_Hub_Logo.svg, whose mark is a picture, not shapes) on a
 * 48-unit grid centred on 24,24, so the mark can be drawn at any size.
 *
 * BrandMark draws it in the header and footer; markSvg draws it as a standalone
 * SVG for the favicon, the app icons, the offline page and the share cards.
 * Both read the shape from here, so the icon on a phone's home screen cannot
 * drift from the logo on the page. The Android app's icons are made from
 * markSvg too: see mobile/scripts/make-icons.mjs.
 */

/** The petals, clockwise from the top. */
export const PETAL_PATHS = [
  "M22.47 2.74C22.27 3.05 22.3 3.49 22.38 3.85C22.43 4.09 22.65 4.26 22.84 4.41C25.1 6.21 27.33 8.05 29.7 9.69C30.07 9.94 30.55 10 30.99 10.06C31.24 10.09 31.5 10.04 31.73 9.97C32 9.88 32.26 9.77 32.48 9.6C32.73 9.39 33.03 9.17 33.12 8.85C33.32 8.2 33.4 7.49 33.31 6.82C33.15 5.55 32.82 4.31 32.38 3.11C32.25 2.76 31.98 2.43 31.64 2.28C31.13 2.04 30.54 2.02 29.97 2C27.85 1.93 25.7 1.79 23.58 2C23.14 2.04 22.71 2.37 22.47 2.74Z",
  "M36.64 6.91C36.47 7 36.43 7.27 36.46 7.47C36.83 9.61 37.3 11.75 37.85 13.86C37.98 14.38 38.19 14.89 38.5 15.34C38.67 15.59 38.95 15.78 39.24 15.89C39.59 16.03 39.99 16.19 40.35 16.08C41.49 15.71 42.55 15.1 43.59 14.51C43.76 14.41 43.91 14.23 43.96 14.04C44.02 13.83 44.02 13.56 43.87 13.39C41.86 11.15 39.81 8.92 37.57 6.91C37.34 6.7 36.92 6.77 36.64 6.91Z",
  "M44.33 18.03C43.37 18.37 42.44 18.82 41.55 19.32C41.23 19.5 40.95 19.77 40.72 20.06C40.55 20.28 40.4 20.53 40.35 20.8C40.27 21.23 40.18 21.7 40.35 22.1C41.43 24.67 42.75 27.14 44.05 29.6C44.12 29.73 44.29 29.81 44.43 29.79C44.55 29.77 44.7 29.64 44.7 29.51C44.76 25.74 44.73 21.98 44.61 18.21C44.61 18.1 44.44 17.99 44.33 18.03Z",
  "M38.96 27.84C38.57 27.75 38.16 27.73 37.76 27.75C37.53 27.76 37.3 27.82 37.11 27.94C36.77 28.14 36.45 28.39 36.18 28.68C36.01 28.86 35.85 29.08 35.81 29.33C35.17 32.89 34.64 36.48 34.14 40.07C34.09 40.47 33.99 40.9 34.14 41.28C34.29 41.64 34.6 42 34.98 42.11C35.39 42.24 35.93 42.2 36.27 41.92C38.43 40.18 40.33 38.14 42.29 36.18C42.44 36.03 42.54 35.83 42.57 35.63C42.64 35.17 42.72 34.68 42.57 34.24C42.03 32.55 41.3 30.93 40.53 29.33C40.34 28.91 40.04 28.53 39.7 28.21C39.5 28.03 39.23 27.91 38.96 27.84Z",
  "M30.72 31.46C30.41 31.25 30.06 31.09 29.7 30.99C29.37 30.9 29.02 30.86 28.68 30.9C28.26 30.95 27.83 31.06 27.47 31.27C27.04 31.53 26.64 31.87 26.36 32.29C24.1 35.74 21.87 39.23 19.88 42.85C19.65 43.26 19.71 43.78 19.79 44.24C19.84 44.58 20.04 44.89 20.25 45.17C20.39 45.36 20.6 45.5 20.8 45.63C21 45.75 21.22 45.9 21.45 45.91C23.8 45.99 26.15 45.99 28.49 45.91C28.73 45.9 28.95 45.77 29.14 45.63C29.42 45.42 29.69 45.18 29.88 44.89C30.07 44.61 30.19 44.29 30.25 43.96C30.84 40.61 31.38 37.24 31.83 33.87C31.87 33.53 31.82 33.18 31.73 32.85C31.66 32.58 31.53 32.33 31.36 32.11C31.18 31.86 30.97 31.63 30.72 31.46Z",
  "M22.75 25.99C22.48 25.8 22.15 25.66 21.82 25.62C21.3 25.56 20.72 25.49 20.25 25.71C15.99 27.7 11.87 29.95 7.74 32.2C7.44 32.37 7.2 32.65 7 32.94C6.83 33.19 6.69 33.47 6.63 33.77C6.56 34.11 6.56 34.46 6.63 34.79C6.69 35.09 6.81 35.39 7 35.63C8.61 37.62 10.19 39.65 12 41.46C12.36 41.81 12.9 41.92 13.39 42.02C13.7 42.08 14.02 42.02 14.32 41.92C14.62 41.83 14.96 41.71 15.15 41.46C18.03 37.86 20.78 34.16 23.49 30.44C23.78 30.05 24.02 29.61 24.14 29.14C24.24 28.72 24.21 28.27 24.14 27.84C24.09 27.54 23.95 27.25 23.77 27.01C23.48 26.63 23.14 26.27 22.75 25.99Z",
  "M3.39 27.38C3.44 27.84 3.89 28.18 4.22 28.49C4.39 28.65 4.64 28.73 4.87 28.77C5.21 28.83 5.58 28.9 5.89 28.77C10.51 26.79 15.13 24.78 19.6 22.47C20.09 22.22 20.44 21.69 20.62 21.17C20.8 20.65 20.79 20.04 20.62 19.51C20.46 19.03 20.07 18.64 19.69 18.3C19.47 18.1 19.16 17.94 18.86 17.93C14.45 17.79 10.03 17.81 5.61 17.84C5.33 17.84 5.03 17.9 4.78 18.03C4.4 18.21 4.02 18.44 3.76 18.77C3.51 19.08 3.31 19.48 3.3 19.88C3.19 22.38 3.12 24.89 3.39 27.38Z",
  "M7.84 11.63C7.77 11.94 7.84 12.26 7.93 12.56C8 12.8 8.13 13.03 8.3 13.21C8.57 13.5 8.87 13.78 9.23 13.95C9.54 14.1 9.9 14.11 10.24 14.13C14.53 14.42 18.82 14.88 23.12 14.88C23.73 14.88 24.32 14.53 24.79 14.13C25.17 13.81 25.43 13.33 25.53 12.84C25.63 12.35 25.55 11.81 25.34 11.36C25.13 10.88 24.77 10.43 24.32 10.15C21.72 8.5 18.99 7.06 16.27 5.61C15.83 5.38 15.36 5.23 14.88 5.15C14.6 5.1 14.31 5.16 14.04 5.24C13.71 5.35 13.37 5.47 13.12 5.71C11.48 7.18 9.86 8.69 8.39 10.34C8.08 10.69 7.93 11.17 7.84 11.63Z",
] as const;

/**
 * The logo's colours: blue-violet at the lower left, lilac through the middle,
 * pink at the upper right. Taken from the artwork rather than the theme tokens,
 * so the mark looks the same on every page, in both themes and on the icons.
 */
export const MARK_COLOURS = { start: "#5b5bf1", middle: "#a77af0", end: "#f7559f" } as const;

/**
 * Gradient geometry on the 48-unit grid. The second, white gradient lightens
 * each petal towards the centre of the ring, as the artwork does.
 */
export const MARK_GRADIENT = { x1: 4, y1: 40, x2: 44, y2: 8 } as const;
export const MARK_HIGHLIGHT = { cx: 24, cy: 24, r: 21, from: 0.35, opacity: 0.26 } as const;

/**
 * The mark as a complete SVG document, on the 48-unit grid. `colour` draws the
 * shape alone in that one colour, for an Android monochrome icon.
 */
export function markSvg({ colour }: { colour?: string } = {}) {
  const petals = PETAL_PATHS.map((d) => `<path d="${d}"/>`).join("");
  if (colour) {
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48"><g fill="${colour}">${petals}</g></svg>`;
  }
  const { start, middle, end } = MARK_COLOURS;
  const { x1, y1, x2, y2 } = MARK_GRADIENT;
  const { cx, cy, r, from, opacity } = MARK_HIGHLIGHT;
  // The petals twice rather than <use>: the share cards are drawn by a
  // renderer that is safest with plain shapes.
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48">` +
    `<defs>` +
    `<linearGradient id="g" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" gradientUnits="userSpaceOnUse">` +
    `<stop offset="0" stop-color="${start}"/><stop offset="0.5" stop-color="${middle}"/>` +
    `<stop offset="1" stop-color="${end}"/></linearGradient>` +
    `<radialGradient id="h" cx="${cx}" cy="${cy}" r="${r}" gradientUnits="userSpaceOnUse">` +
    `<stop offset="${from}" stop-color="#fff" stop-opacity="${opacity}"/>` +
    `<stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>` +
    `</defs>` +
    `<g fill="url(#g)">${petals}</g><g fill="url(#h)">${petals}</g>` +
    `</svg>`
  );
}

/** A short fingerprint of a text (djb2), the same on the server and in a build. */
function fingerprint(text: string) {
  let hash = 5381;
  for (let index = 0; index < text.length; index += 1) {
    hash = ((hash * 33) ^ text.charCodeAt(index)) >>> 0;
  }
  return hash.toString(36);
}

/**
 * Changes whenever the mark does. Browsers keep a tab icon by its address for
 * months, whatever the server says, so when the mark changed from the ring to
 * the petals, tabs kept showing the ring. With this in every icon address
 * (iconUrl), a new mark is a new address, fetched on the next visit.
 */
export const MARK_VERSION = fingerprint(markSvg());

/** An icon from app/icons, at an address that changes with the mark. */
export function iconUrl(name: string) {
  return `/icons/${name}?v=${MARK_VERSION}`;
}
