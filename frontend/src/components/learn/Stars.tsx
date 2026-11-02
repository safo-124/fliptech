"use client";

import { Star } from "lucide-react";
import { useState } from "react";

/** Stars to read: whole, half and empty, from an average. */
export function Stars({ value, size = "size-4", label }: { value: number; size?: string; label?: string }) {
  return (
    <span role="img" aria-label={label ?? `${value} / 5`} className="inline-flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map((n) => {
        const fill = Math.max(0, Math.min(1, value - (n - 1)));
        return (
          <span key={n} aria-hidden="true" className={`relative ${size}`}>
            <Star className={`absolute inset-0 ${size} text-[var(--color-border-strong)]`} />
            <span className="absolute inset-0 overflow-hidden" style={{ width: `${fill * 100}%` }}>
              <Star className={`${size} fill-[var(--color-warn)] text-[var(--color-warn)]`} />
            </span>
          </span>
        );
      })}
    </span>
  );
}

/** Stars to choose, one to five, as a radio group. */
export function StarPicker({
  value,
  onChange,
  label,
  names,
}: {
  value: number;
  onChange: (value: number) => void;
  label: string;
  /** "Poor" to "Excellent", one per star. */
  names: string[];
}) {
  const [hover, setHover] = useState(0);
  const shown = hover || value;
  return (
    <div className="flex items-center gap-3">
      <div role="radiogroup" aria-label={label} className="flex" onPointerLeave={() => setHover(0)}>
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            role="radio"
            aria-checked={value === n}
            aria-label={names[n - 1]}
            onClick={() => onChange(n)}
            onPointerEnter={() => setHover(n)}
            className="grid size-10 place-items-center rounded-full transition-transform hover:scale-110 active:scale-95"
          >
            <Star
              aria-hidden="true"
              className={`size-7 transition-colors ${
                n <= shown ? "fill-[var(--color-warn)] text-[var(--color-warn)]" : "text-[var(--color-border-strong)]"
              }`}
            />
          </button>
        ))}
      </div>
      {shown ? <span className="text-sm font-semibold text-[var(--color-muted-foreground)]">{names[shown - 1]}</span> : null}
    </div>
  );
}
