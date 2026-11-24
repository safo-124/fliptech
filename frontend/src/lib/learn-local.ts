/**
 * Progress kept on this phone, for someone watching without signing in.
 *
 * Ticks and "carry on from 3:12" should not need an account. Signed in, the
 * server's record is what counts (backend courses/learner.py) and follows
 * the learner to any phone; this is the fallback, and the same shape.
 */

import type {LessonProgressRow} from "./types";

const KEY = "fliptech:learn:";
export const FINISHED_SHARE = 0.9;

export type ProgressMap = Record<string, LessonProgressRow>;

export function readLocal(courseId: number): ProgressMap {
  try {
    const raw = window.localStorage.getItem(`${KEY}${courseId}`);
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === "object" ? (parsed as ProgressMap) : {};
  } catch {
    return {};
  }
}

export function writeLocal(courseId: number, progress: ProgressMap) {
  try {
    window.localStorage.setItem(`${KEY}${courseId}`, JSON.stringify(progress));
  } catch {
    // Storage blocked: progress lasts until the page closes.
  }
}

/** A played stretch of a lesson, in seconds: [start, end]. */
export type Played = [number, number];

/** Stretches sorted and joined where they touch or overlap. */
export function mergePlayed(ranges: Played[]): Played[] {
  const merged: Played[] = [];
  for (const [start, end] of [...ranges].sort((a, b) => a[0] - b[0])) {
    const last = merged[merged.length - 1];
    if (last && start <= last[1] + 1) last[1] = Math.max(last[1], end);
    else merged.push([start, end]);
  }
  return merged;
}

export function playedSeconds(ranges: Played[]) {
  return mergePlayed(ranges).reduce((sum, [start, end]) => sum + (end - start), 0);
}

/**
 * Following the playhead. A step forward of up to 3 seconds between two
 * readings is playing (timeupdate fires a few times a second, at any speed
 * up to 2x); a bigger jump, or going back, is a seek and plays nothing.
 */
export type PlayTracker = {last: number | null; pending: Played[]};

export function newTracker(): PlayTracker {
  return {last: null, pending: []};
}

export function trackPlayhead(tracker: PlayTracker, at: number) {
  const last = tracker.last;
  if (last !== null && at > last && at - last <= 3) {
    tracker.pending = mergePlayed([...tracker.pending, [last, at]]);
  }
  tracker.last = at;
}

/** The stretches played since the last report, for the server; then clear. */
export function takePlayed(tracker: PlayTracker): Played[] {
  const out = tracker.pending.map(([start, end]): Played => [Math.floor(start), Math.ceil(end)]);
  tracker.pending = [];
  return out;
}

/** The same rule as the server: 90% of the lesson actually played. */
export function isFinished(watched: number, duration: number) {
  if (!duration) return watched > 0;
  return watched >= duration * FINISHED_SHARE;
}

export function advance(
  row: LessonProgressRow | undefined,
  position: number,
  duration: number,
  played: Played[],
): LessonProgressRow {
  const furthest = Math.max(row?.furthest ?? 0, Math.floor(position));
  const ranges = mergePlayed([...(row?.watched ?? []), ...played]);
  return {
    position: Math.floor(position),
    furthest,
    watched: ranges,
    completed: Boolean(row?.completed) || isFinished(playedSeconds(ranges), duration),
  };
}
