/**
 * The brand name, in one place.
 *
 * It appears in the header, the footer disclaimer, both trust badges and the
 * verification block — all copy a trainee reads when deciding whether to
 * believe a listing. The ORC name search was still pending when this was built,
 * so correcting the spelling is one environment variable rather than a search
 * across the components.
 */
export const BRAND = process.env.NEXT_PUBLIC_BRAND_NAME ?? "Fliiptech";

/**
 * The brand colours as hex, for the places CSS variables cannot reach: the
 * browser's theme colour, the web app manifest, the app icons and the offline
 * page. Converted from the oklch tokens of the same names in globals.css; change
 * them together.
 */
export const BRAND_COLOURS = {
  /** --color-brand-deep, the indigo of the header and footer bands. */
  deep: "#26005a",
  /** The lighter indigo glow the bands carry at their top left. */
  glow: "#491889",
  /** --color-background, the light canvas. */
  canvas: "#fbf9f5",
  /** The mark's gradient: --color-brand-violet, its midpoint, --color-brand-pink. */
  violet: "#9867e1",
  orchid: "#ca61d1",
  pink: "#f072b3",
} as const;
