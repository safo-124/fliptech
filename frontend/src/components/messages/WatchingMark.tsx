"use client";

/**
 * The Fliiptech mark with two big eyes, for the floating messages button
 * (FloatingMessages.tsx). The petals are the logo's own (lib/brand-mark.ts),
 * untouched; the eyes sit in the ring's open middle (lib/watching-eyes.ts).
 *
 * - With a mouse, the eyes follow the pointer anywhere on the page. The
 *   pupils are moved directly, once per frame at most, so following the
 *   pointer never re-renders anything.
 * - On a phone, they glance towards a tap. Left alone for a while, they look
 *   around now and then.
 * - When a new message arrives they look up at the count, and while the panel
 *   is open they look up into it.
 * - A blink every few seconds. With "reduce motion" on, the eyes stay still,
 *   looking straight ahead.
 */

import { useEffect, useRef } from "react";

import { MARK_COLOURS, MARK_GRADIENT, MARK_HIGHLIGHT, PETAL_PATHS } from "@/lib/brand-mark";
import { EYE_RADIUS, EYES, GLANCE, PUPIL_RADIUS, REACH, pupilOffset } from "@/lib/watching-eyes";

import styles from "./WatchingMark.module.css";

/** No pointer movement for this long, and the eyes start to look around. */
const IDLE_MS = 6000;
const WANDER_EVERY_MS = 4500;
const WANDER_FOR_MS = 1400;
const GLANCE_MS = 1600;

type Offset = { x: number; y: number };
const AHEAD: Offset = { x: 0, y: 0 };

function place(pupils: (SVGGElement | null)[], offsets: Offset[]) {
  pupils.forEach((pupil, index) => {
    const offset = offsets[index] ?? AHEAD;
    if (pupil) pupil.style.transform = `translate(${offset.x.toFixed(2)}px, ${offset.y.toFixed(2)}px)`;
  });
}

const stillWanted = () =>
  typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export function WatchingMark({
  className = "size-10",
  looking = null,
  count = 0,
}: {
  className?: string;
  /** "panel": look up into the open messages panel. */
  looking?: "panel" | null;
  /** The unread count: when it goes up, a glance at it. */
  count?: number;
}) {
  const svg = useRef<SVGSVGElement>(null);
  const pupils = useRef<(SVGGElement | null)[]>([]);
  // A fixed look (the panel, the count) that the pointer does not override.
  const held = useRef<Offset | null>(null);
  const lastMove = useRef(0);
  const shownCount = useRef(count);

  // Following the pointer, and looking around when left alone.
  useEffect(() => {
    if (stillWanted()) return;
    let frame = 0;
    let point: { x: number; y: number } | null = null;
    const timers = new Set<number>();

    const draw = () => {
      frame = 0;
      const box = svg.current?.getBoundingClientRect();
      if (!box || !point || held.current) return;
      const at = point;
      place(pupils.current, EYES.map((eye) => pupilOffset(eye, at, box)));
    };
    const onPointer = (event: PointerEvent) => {
      lastMove.current = Date.now();
      point = { x: event.clientX, y: event.clientY };
      if (!frame) frame = window.requestAnimationFrame(draw);
    };
    const wander = window.setInterval(() => {
      if (held.current || Date.now() - lastMove.current < IDLE_MS || document.hidden) return;
      const angle = Math.random() * Math.PI * 2;
      const pull = REACH * (0.5 + Math.random() * 0.5);
      const look = { x: Math.cos(angle) * pull, y: Math.sin(angle) * pull };
      place(pupils.current, [look, look]);
      const back = window.setTimeout(() => {
        timers.delete(back);
        if (!held.current && Date.now() - lastMove.current >= IDLE_MS) place(pupils.current, [AHEAD, AHEAD]);
      }, WANDER_FOR_MS);
      timers.add(back);
    }, WANDER_EVERY_MS);

    window.addEventListener("pointermove", onPointer, { passive: true });
    // A tap on a phone moves no pointer: a glance towards it instead.
    window.addEventListener("pointerdown", onPointer, { passive: true });
    return () => {
      window.removeEventListener("pointermove", onPointer);
      window.removeEventListener("pointerdown", onPointer);
      window.clearInterval(wander);
      timers.forEach((timer) => window.clearTimeout(timer));
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, []);

  // Up into the open panel; straight ahead again once it closes.
  useEffect(() => {
    if (stillWanted()) return;
    held.current = looking === "panel" ? GLANCE.panel : null;
    place(pupils.current, looking === "panel" ? [GLANCE.panel, GLANCE.panel] : [AHEAD, AHEAD]);
  }, [looking]);

  // A new message: a look up at the count, then back.
  useEffect(() => {
    const before = shownCount.current;
    shownCount.current = count;
    if (count <= before || looking === "panel" || stillWanted()) return;
    held.current = GLANCE.badge;
    place(pupils.current, [GLANCE.badge, GLANCE.badge]);
    const back = window.setTimeout(() => {
      if (held.current !== GLANCE.badge) return;
      held.current = null;
      place(pupils.current, [AHEAD, AHEAD]);
    }, GLANCE_MS);
    return () => window.clearTimeout(back);
  }, [count, looking]);

  const { x1, y1, x2, y2 } = MARK_GRADIENT;
  const { cx, cy, r, from, opacity } = MARK_HIGHLIGHT;
  return (
    <svg ref={svg} viewBox="0 0 48 48" className={className} aria-hidden="true">
      <defs>
        {/* Ids of its own: the header's mark has the plain ones. */}
        <linearGradient id="fliiptech-watch-gradient" x1={x1} y1={y1} x2={x2} y2={y2} gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor={MARK_COLOURS.start} />
          <stop offset="0.5" stopColor={MARK_COLOURS.middle} />
          <stop offset="1" stopColor={MARK_COLOURS.end} />
        </linearGradient>
        <radialGradient id="fliiptech-watch-highlight" cx={cx} cy={cy} r={r} gradientUnits="userSpaceOnUse">
          <stop offset={from} stopColor="#fff" stopOpacity={opacity} />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </radialGradient>
      </defs>
      <g fill="url(#fliiptech-watch-gradient)">
        {PETAL_PATHS.map((d) => (
          <path key={d} d={d} />
        ))}
      </g>
      <g fill="url(#fliiptech-watch-highlight)">
        {PETAL_PATHS.map((d) => (
          <path key={d} d={d} />
        ))}
      </g>
      {EYES.map((eye, index) => (
        <g key={eye.cx} className={styles.lid}>
          <circle cx={eye.cx} cy={eye.cy} r={EYE_RADIUS} fill="#ffffff" stroke="#e2dcf6" strokeWidth={0.35} />
          <g
            ref={(element) => {
              pupils.current[index] = element;
            }}
            className={styles.pupil}
          >
            <circle cx={eye.cx} cy={eye.cy} r={PUPIL_RADIUS} fill="#24223a" />
            <circle cx={eye.cx + 0.6} cy={eye.cy - 0.65} r={0.55} fill="#ffffff" />
          </g>
        </g>
      ))}
    </svg>
  );
}
