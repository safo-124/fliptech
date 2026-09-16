/**
 * The Fliiptech aperture mark.
 *
 * Drawn rather than shipped as a file: it appears in the header on every page,
 * in the footer and at 512px in the PWA icon, and an SVG that inherits the
 * theme's own gradient tokens stays sharp at all three without three exports
 * to keep in sync. It is also about 700 bytes, against ~8KB for a PNG that
 * would still be soft on a 3x phone screen.
 *
 * The gradient runs violet at the lower left to pink at the upper right,
 * matching the logo. Each blade is a tapered quadrilateral stroked in its own
 * fill colour, which is what rounds the corners — `stroke-linejoin: round`
 * costs one attribute where a hand-built rounded path would cost twelve arcs.
 *
 * Decorative by default: `aria-hidden` unless a `title` is passed, because in
 * the header it sits beside the wordmark and a screen reader announcing both
 * would read the brand twice.
 */

const BLADE_COUNT = 12;

/** Inner and outer radius of a blade, and its half-width at each end. */
const INNER_RADIUS = 8.5;
const OUTER_RADIUS = 19;
const INNER_HALF_WIDTH = 1.9;
const OUTER_HALF_WIDTH = 3.6;

const BLADE_PATH = [
  `M ${-INNER_HALF_WIDTH} ${-INNER_RADIUS}`,
  `L ${-OUTER_HALF_WIDTH} ${-OUTER_RADIUS}`,
  `L ${OUTER_HALF_WIDTH} ${-OUTER_RADIUS}`,
  `L ${INNER_HALF_WIDTH} ${-INNER_RADIUS}`,
  "Z",
].join(" ");

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
        {Array.from({ length: BLADE_COUNT }, (_, index) => {
          // The logo's ring is not quite closed: one blade is dropped at the
          // three-o'clock position and a dot sits in the gap.
          if (index === 3) return null;
          return (
            <path
              key={index}
              d={BLADE_PATH}
              transform={`rotate(${(index * 360) / BLADE_COUNT})`}
              strokeWidth="1.6"
              strokeLinejoin="round"
            />
          );
        })}
        <circle cx={OUTER_RADIUS - 5} cy="0" r="2.6" />
      </g>
    </svg>
  );
}
