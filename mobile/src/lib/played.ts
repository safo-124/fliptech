/**
 * What of a lesson was actually played, as opposed to skipped. The server
 * counts a lesson finished at 90% played (backend courses/learner.py), so a
 * jump to the end completes nothing. Same rule as the website
 * (frontend lib/learn-local.ts).
 */

export type Played = [number, number];

export function mergePlayed(ranges: Played[]): Played[] {
  const merged: Played[] = [];
  for (const [start, end] of [...ranges].sort((a, b) => a[0] - b[0])) {
    const last = merged[merged.length - 1];
    if (last && start <= last[1] + 1) last[1] = Math.max(last[1], end);
    else merged.push([start, end]);
  }
  return merged;
}

/** A step forward of up to 3 seconds between readings is playing; more, or back, is a seek. */
export type PlayTracker = { last: number | null; pending: Played[] };

export function newTracker(): PlayTracker {
  return { last: null, pending: [] };
}

export function trackPlayhead(tracker: PlayTracker, at: number) {
  const last = tracker.last;
  if (last !== null && at > last && at - last <= 3) {
    tracker.pending = mergePlayed([...tracker.pending, [last, at]]);
  }
  tracker.last = at;
}

export function takePlayed(tracker: PlayTracker): Played[] {
  const out = tracker.pending.map(([start, end]): Played => [Math.floor(start), Math.ceil(end)]);
  tracker.pending = [];
  return out;
}
