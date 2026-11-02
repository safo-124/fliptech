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
export const FINISHED_TAIL_SECONDS = 20;

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

/** The same rule as the server: 90% in, or into the last 20 seconds. */
export function isFinished(position: number, duration: number) {
  if (!duration) return position > 0;
  return position >= duration * FINISHED_SHARE || position >= duration - FINISHED_TAIL_SECONDS;
}

export function advance(
  row: LessonProgressRow | undefined,
  position: number,
  duration: number,
  ended: boolean,
): LessonProgressRow {
  const furthest = Math.max(row?.furthest ?? 0, Math.floor(position));
  return {
    position: Math.floor(position),
    furthest,
    completed: Boolean(row?.completed) || ended || isFinished(furthest, duration),
  };
}
