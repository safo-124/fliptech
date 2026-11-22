/**
 * The Fliiptech mark: eight petals in a ring that opens on the right.
 *
 * Drawn rather than shipped as a file: it appears in the header on every page,
 * in the footer and at 512px in the PWA icon, and an SVG stays sharp at all
 * three without three exports to keep in sync. The shape and colours live in
 * lib/brand-mark.ts, traced from the logo artwork, which the app icons draw
 * from too.
 *
 * The gradient runs blue-violet at the lower left to pink at the upper right,
 * matching the logo.
 *
 * Decorative by default: `aria-hidden` unless a `title` is passed, because in
 * the header it sits beside the wordmark and a screen reader announcing both
 * would read the brand twice.
 */

import { MARK_COLOURS, MARK_GRADIENT, MARK_HIGHLIGHT, PETAL_PATHS } from "@/lib/brand-mark";

/**
 * `motion` makes the aperture move, in CSS alone (globals.css):
 *
 *   open     the blades swing open once, as the page arrives: the header
 *   breathe  they close and open in a loop, while a page is loading
 *
 * An aperture opening is the brand's own way of saying "now you can see
 * clearly", so it does the job a generic spinner would. Both are switched off
 * for anyone whose device asks for reduced motion.
 */
export function BrandMark({
  className = "size-9",
  title,
  motion,
}: {
  className?: string;
  title?: string;
  motion?: "open" | "breathe";
}) {
  // One gradient id per render would be ideal, but this mark is a singleton in
  // practice and a stable id keeps the markup identical between the server and
  // client renders — a generated one would hydrate-mismatch.
  const gradientId = "fliiptech-mark-gradient";
  const highlightId = "fliiptech-mark-highlight";
  const petalsId = "fliiptech-mark-petals";
  const { x1, y1, x2, y2 } = MARK_GRADIENT;
  const { cx, cy, r, from, opacity } = MARK_HIGHLIGHT;

  return (
    <svg
      viewBox="0 0 48 48"
      className={className}
      role={title ? "img" : undefined}
      aria-hidden={title ? undefined : true}
      aria-label={title}
    >
      <defs>
        <linearGradient id={gradientId} x1={x1} y1={y1} x2={x2} y2={y2} gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor={MARK_COLOURS.start} />
          <stop offset="0.5" stopColor={MARK_COLOURS.middle} />
          <stop offset="1" stopColor={MARK_COLOURS.end} />
        </linearGradient>
        {/* Each petal lighter towards the centre of the ring, as in the logo. */}
        <radialGradient id={highlightId} cx={cx} cy={cy} r={r} gradientUnits="userSpaceOnUse">
          <stop offset={from} stopColor="#fff" stopOpacity={opacity} />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </radialGradient>
      </defs>

      <g className={motion ? `mark-${motion}` : undefined}>
        {/* The fill sits on the wrapper, not on the petals' own group, so the
            copy below takes the highlight instead of the gradient. */}
        <g fill={`url(#${gradientId})`}>
          <g id={petalsId}>
            {PETAL_PATHS.map((d) => (
              <path key={d} d={d} />
            ))}
          </g>
        </g>
        <use href={`#${petalsId}`} fill={`url(#${highlightId})`} />
      </g>
    </svg>
  );
}
