/**
 * The warm shards from the lower right of the Fliiptech logo.
 *
 * Purely decorative, and always `aria-hidden`. They exist to keep the indigo
 * bands from reading as a generic dark hero: the sand-to-coral wedges are the
 * one thing in this palette that is specific to the brand.
 *
 * Drawn as SVG rather than CSS pseudo-elements. The first attempt used
 * `border-radius` blobs, which at hero size became large soft circles — the
 * logo's shards are angular wedges, and the difference is most of the
 * character. Each wedge is a four-point path stroked in its own fill with
 * `stroke-linejoin: round`, which rounds the corners without hand-built arcs.
 *
 * `preserveAspectRatio="xMaxYMax meet"` anchors the cluster to the bottom
 * right and scales the whole of it to fit, so one drawing works in a 4rem
 * header and a 24rem hero without re-laying-out the shapes. `slice` was the
 * first attempt and cropped the three wedges into one flat slab at hero size.
 */

type Shard = {
  d: string;
  fill: string;
  opacity: number;
  transform?: string;
};

const SHARDS: Shard[] = [
  {
    d: "M 96 26 L 168 6 L 184 62 L 116 84 Z",
    fill: "var(--color-sand)",
    opacity: 0.9,
    transform: "rotate(-8 140 45)",
  },
  {
    d: "M 118 96 L 186 78 L 198 140 L 132 158 Z",
    fill: "var(--color-peach)",
    opacity: 0.85,
    transform: "rotate(6 160 118)",
  },
  {
    d: "M 74 140 L 138 128 L 150 190 L 86 200 Z",
    fill: "var(--color-coral)",
    opacity: 0.8,
    transform: "rotate(-4 112 164)",
  },
];

export function BrandShards({ className = "" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 200 200"
      className={className}
      preserveAspectRatio="xMaxYMax meet"
      aria-hidden="true"
      focusable="false"
    >
      {SHARDS.map((shard) => (
        <path
          key={shard.d}
          d={shard.d}
          fill={shard.fill}
          stroke={shard.fill}
          strokeWidth="18"
          strokeLinejoin="round"
          opacity={shard.opacity}
          transform={shard.transform}
        />
      ))}
    </svg>
  );
}
