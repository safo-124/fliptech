/**
 * The Fliiptech aperture mark.
 *
 * Drawn rather than shipped as a file: it appears in the header on every page,
 * in the footer and at 512px in the PWA icon, and an SVG that inherits the
 * theme's own gradient tokens stays sharp at all three without three exports
 * to keep in sync. It is also about 700 bytes, against ~8KB for a PNG that
 * would still be soft on a 3x phone screen. The shape lives in
 * lib/brand-mark.ts, which the app icons draw from too.
 *
 * The gradient runs violet at the lower left to pink at the upper right,
 * matching the logo.
 *
 * Decorative by default: `aria-hidden` unless a `title` is passed, because in
 * the header it sits beside the wordmark and a screen reader announcing both
 * would read the brand twice.
 */

import { BLADE_ANGLES, BLADE_PATH, MARK_DOT } from "@/lib/brand-mark";

export function BrandMark({
  className = "size-9",
  title,
}: {
  className?: string;
  title?: string;
}) {
  // One gradient id per render would be ideal, but this mark is a singleton in
  // practice and a stable id keeps the markup identical between the server and
  // client renders — a generated one would hydrate-mismatch.
  const gradientId = "fliiptech-mark-gradient";

  return (
    <svg
      viewBox="0 0 48 48"
      className={className}
      role={title ? "img" : undefined}
      aria-hidden={title ? undefined : true}
      aria-label={title}
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="1" x2="1" y2="0">
          <stop offset="0%" stopColor="var(--color-brand-violet)" />
          <stop offset="55%" stopColor="oklch(0.66 0.19 325)" />
          <stop offset="100%" stopColor="var(--color-brand-pink)" />
        </linearGradient>
      </defs>

      <g transform="translate(24 24)" fill={`url(#${gradientId})`} stroke={`url(#${gradientId})`}>
        {BLADE_ANGLES.map((angle) => (
          <path
            key={angle}
            d={BLADE_PATH}
            transform={`rotate(${angle})`}
            strokeWidth="1.6"
            strokeLinejoin="round"
          />
        ))}
        <circle cx={MARK_DOT.cx} cy="0" r={MARK_DOT.r} />
      </g>
    </svg>
  );
}
