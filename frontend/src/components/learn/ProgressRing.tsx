/** A ring that fills as a course is finished, with the share in the middle. */
export function ProgressRing({
  value,
  size = 56,
  stroke = 6,
  label,
  className = "",
  tone = "brand",
}: {
  /** 0 to 100. */
  value: number;
  size?: number;
  stroke?: number;
  label?: string;
  className?: string;
  tone?: "brand" | "light";
}) {
  const radius = (size - stroke) / 2;
  const length = 2 * Math.PI * radius;
  const share = Math.max(0, Math.min(100, value));
  const id = `ring-${size}-${stroke}-${tone}`;
  return (
    <span
      role="img"
      aria-label={label ?? `${Math.round(share)}%`}
      className={`relative inline-grid shrink-0 place-items-center ${className}`}
      style={{ width: size, height: size }}
    >
      <svg viewBox={`0 0 ${size} ${size}`} className="absolute inset-0 -rotate-90" aria-hidden="true">
        <defs>
          <linearGradient id={id} x1="0" x2="1" y1="0" y2="1">
            <stop offset="0%" stopColor="var(--color-brand-violet)" />
            <stop offset="100%" stopColor="var(--color-brand-pink)" />
          </linearGradient>
        </defs>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          strokeWidth={stroke}
          className={tone === "light" ? "stroke-white/20" : "stroke-[var(--color-muted)]"}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={`url(#${id})`}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={length}
          strokeDashoffset={length * (1 - share / 100)}
          className="transition-[stroke-dashoffset] duration-700 ease-out"
        />
      </svg>
      <span
        aria-hidden="true"
        className={`text-[0.7rem] font-extrabold tabular-nums ${tone === "light" ? "text-white" : "text-[var(--color-brand-deep)]"}`}
        style={{ fontSize: Math.max(10, size / 4.6) }}
      >
        {Math.round(share)}%
      </span>
    </span>
  );
}
