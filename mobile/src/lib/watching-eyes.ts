/**
 * Where the eyes on the Messages button look (components/WatchingMark.tsx),
 * the same rules as the website's (frontend lib/watching-eyes.ts).
 *
 * Two eyes sit in the open middle of the Fliiptech ring, on the mark's
 * 48-unit grid. Each pupil moves towards a point on the screen, never
 * further than REACH from the eye's centre, and less when the point is close.
 */

export const EYES = [
  { cx: 26.5, cy: 20.6 },
  { cx: 33.4, cy: 20.6 },
] as const;
export const EYE_RADIUS = 3.35;
export const PUPIL_RADIUS = 1.75;
/** How far a pupil may move from the eye's centre, in grid units. */
export const REACH = 1.45;

/** Where a pupil moves, in grid units, to look at a point on the screen.
 * `box` is the mark's place on the screen (from measureInWindow). */
export function pupilOffset(
  eye: { cx: number; cy: number },
  point: { x: number; y: number },
  box: { left: number; top: number; width: number },
): { x: number; y: number } {
  const scale = box.width / 48;
  const dx = point.x - (box.left + eye.cx * scale);
  const dy = point.y - (box.top + eye.cy * scale);
  const distance = Math.hypot(dx, dy);
  if (distance < 0.5) return { x: 0, y: 0 };
  const pull = Math.min(distance / (box.width * 2), 1) * REACH;
  return { x: (dx / distance) * pull, y: (dy / distance) * pull };
}

/** A fixed glance, in grid units: up at the unread count (top right). */
export const GLANCE_BADGE = { x: REACH * 0.6, y: -REACH * 0.8 } as const;
