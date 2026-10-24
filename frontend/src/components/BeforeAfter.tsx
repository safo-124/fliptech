"use client";

import Image from "next/image";
import { useState } from "react";

/**
 * The same piece of work before and after, one over the other, with a handle
 * to drag between them.
 *
 * A braid beside the hair it started as shows skill in a way two unrelated
 * photographs cannot. The drag is a range input stretched over the picture,
 * so it works by touch, mouse and keyboard, and a screen reader hears a
 * slider with its label. Labels come as props: the listing page loads no
 * message formatter for them.
 */
export function BeforeAfter({
  before,
  after,
  alt,
  labels,
}: {
  before: string;
  after: string;
  alt: string;
  labels: { before: string; after: string; slider: string };
}) {
  const [position, setPosition] = useState(50);

  return (
    <div className="relative aspect-4/3 select-none overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--color-muted)]">
      <Image
        src={after}
        alt={alt}
        fill
        loading="lazy"
        sizes="(max-width: 640px) 100vw, 520px"
        className="object-cover"
      />
      <div className="absolute inset-0" style={{ clipPath: `inset(0 ${100 - position}% 0 0)` }}>
        <Image
          src={before}
          alt=""
          fill
          loading="lazy"
          sizes="(max-width: 640px) 100vw, 520px"
          className="object-cover"
        />
      </div>

      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-y-0 w-0.5 -translate-x-1/2 bg-white shadow-[0_0_0_1px_rgb(0_0_0/0.15)]"
        style={{ left: `${position}%` }}
      >
        <span className="absolute left-1/2 top-1/2 grid size-9 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-white text-xs font-bold text-[var(--color-foreground)] shadow-md">
          ⇆
        </span>
      </div>
      <span
        aria-hidden="true"
        className="pointer-events-none absolute left-2 top-2 rounded-full bg-black/65 px-2 py-0.5 text-xs font-semibold text-white"
      >
        {labels.before}
      </span>
      <span
        aria-hidden="true"
        className="pointer-events-none absolute right-2 top-2 rounded-full bg-black/65 px-2 py-0.5 text-xs font-semibold text-white"
      >
        {labels.after}
      </span>

      <input
        type="range"
        min={0}
        max={100}
        value={position}
        onChange={(event) => setPosition(Number(event.target.value))}
        aria-label={labels.slider}
        className="absolute inset-0 h-full w-full cursor-ew-resize opacity-0"
      />
    </div>
  );
}
