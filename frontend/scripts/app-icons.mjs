/**
 * The Android app's icons, drawn from the website's own mark.
 *
 *   pnpm icons:app      (from frontend/)
 *
 * Writes the PNGs mobile/app.json points at, from markSvg in
 * src/lib/brand-mark.ts, so the icon on a phone cannot drift from the logo on
 * the site. Run it again after changing the mark, then make a new app build:
 * launcher icons and the splash are part of the build, not an update.
 *
 * Here rather than in mobile/ because sharp is a website dependency already.
 */

import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import sharp from "sharp";

import { BRAND_COLOURS } from "../src/lib/brand.ts";
import { markSvg } from "../src/lib/brand-mark.ts";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "mobile", "assets", "images");
const { deep, glow } = BRAND_COLOURS;

/** The mark's SVG placed at (x, y) and `size` wide inside a larger drawing. */
function placed(svg, x, y, size) {
  return svg.replace(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48">',
    `<svg x="${x}" y="${y}" width="${size}" height="${size}" viewBox="0 0 48 48">`,
  );
}

/**
 * A square drawing `canvas` wide with the mark `share` of it, centred. With
 * `tile`, it sits on the header band's indigo and its glow at the top left,
 * as the website's own app icons do (app/icons/[name]/route.tsx).
 */
function drawing(canvas, share, { tile = false, colour } = {}) {
  const size = Math.round(canvas * share);
  const offset = Math.round((canvas - size) / 2);
  const background = tile
    ? `<defs><radialGradient id="bandglow" cx="${canvas * 0.15}" cy="0" r="${canvas * 0.92}" gradientUnits="userSpaceOnUse">` +
      `<stop offset="0" stop-color="${glow}"/><stop offset="1" stop-color="${deep}"/></radialGradient></defs>` +
      `<rect width="${canvas}" height="${canvas}" fill="url(#bandglow)"/>`
    : "";
  const mark = size > 0 ? placed(markSvg({ colour }), offset, offset, size) : "";
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${canvas}" height="${canvas}" viewBox="0 0 ${canvas} ${canvas}">` +
      background +
      mark +
      `</svg>`,
  );
}

// Android crops an adaptive icon to a circle, squircle or square of its own
// choosing and keeps only the middle 66 of 108 units safe: 0.62 keeps every
// petal inside that, the same as the website's maskable icon.
const ICONS = [
  { file: "icon.png", svg: drawing(1024, 0.66, { tile: true }), flatten: true },
  { file: "android-icon-foreground.png", svg: drawing(1024, 0.62) },
  { file: "android-icon-background.png", svg: drawing(1024, 0, { tile: true }), flatten: true },
  { file: "android-icon-monochrome.png", svg: drawing(1024, 0.62, { colour: "#ffffff" }) },
  // On the splash screen's indigo, shown 120 wide (app.json).
  { file: "splash-icon.png", svg: drawing(512, 0.94) },
  { file: "favicon.png", svg: drawing(48, 0.8, { tile: true }), flatten: true },
];

mkdirSync(OUT, { recursive: true });
for (const { file, svg, flatten } of ICONS) {
  let image = sharp(svg, { density: 72 });
  if (flatten) image = image.flatten({ background: deep });
  await image.png({ compressionLevel: 9 }).toFile(join(OUT, file));
  console.log(`wrote mobile/assets/images/${file}`);
}
