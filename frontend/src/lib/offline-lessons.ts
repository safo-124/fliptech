/**
 * Lessons kept on this phone, to watch again without spending data.
 *
 * The 360p copy is fetched once, through the same lock as playing it
 * (Caddy asks Django before handing over a paid lesson's file), and kept in
 * the browser's Cache Storage. It plays from there inside the site and
 * nowhere else: a file in the phone's gallery could be passed on, which
 * would be the trainer's paid course given away. What is kept is listed in
 * localStorage, so /learn/saved can show it with no signal at all.
 *
 * Everything here fails quietly. A private window, a full phone or an old
 * browser simply has no "save" button.
 */

import {useSyncExternalStore} from "react";

import type {ProviderVideo} from "./types";

const CACHE = "lessons-v1";
const INDEX = "fliptech:offline-lessons";
const EVENT = "fliptech:offline-lessons";

export type SavedLesson = {
  id: number;
  title: string;
  url: string;
  bytes: number | null;
  poster: string | null;
  duration_seconds: number | null;
  course: {name: string; area: string; slug: string};
  savedAt: string;
};

export function canSaveOffline() {
  return typeof window !== "undefined" && "caches" in window && "localStorage" in window;
}

function readIndex(): SavedLesson[] {
  try {
    const raw = window.localStorage.getItem(INDEX);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? (parsed as SavedLesson[]) : [];
  } catch {
    return [];
  }
}

function writeIndex(lessons: SavedLesson[]) {
  try {
    window.localStorage.setItem(INDEX, JSON.stringify(lessons));
    window.dispatchEvent(new Event(EVENT));
  } catch {
    // Storage full or blocked: the lesson is still in the cache.
  }
}

export function savedLessons(): SavedLesson[] {
  return canSaveOffline() ? readIndex() : [];
}

export function isSaved(id: number) {
  return savedLessons().some((lesson) => lesson.id === id);
}

/** Subscribe to the list changing, in this tab or another. */
export function onSavedChange(listener: () => void) {
  if (typeof window === "undefined") return () => {};
  const storage = (event: StorageEvent) => {
    if (event.key === INDEX) listener();
  };
  window.addEventListener(EVENT, listener);
  window.addEventListener("storage", storage);
  return () => {
    window.removeEventListener(EVENT, listener);
    window.removeEventListener("storage", storage);
  };
}

/**
 * Fetch the smallest copy and keep it. `onProgress` gets 0 to 1 when the
 * size is known. Throws when the lesson cannot be fetched (locked, offline).
 */
export async function saveLesson(
  video: ProviderVideo,
  course: SavedLesson["course"],
  onProgress?: (share: number) => void,
) {
  const source = video.sources[0];
  if (!source || !canSaveOffline()) throw new Error("This lesson cannot be saved.");
  const response = await fetch(source.url, {credentials: "include"});
  if (!response.ok || !response.body) throw new Error("This lesson cannot be saved.");

  const total = Number(response.headers.get("Content-Length")) || source.bytes || 0;
  const reader = response.body.getReader();
  const parts: BlobPart[] = [];
  let received = 0;
  for (;;) {
    const {done, value} = await reader.read();
    if (done) break;
    parts.push(value);
    received += value.length;
    if (total && onProgress) onProgress(Math.min(1, received / total));
  }
  const blob = new Blob(parts, {type: "video/mp4"});
  const cache = await caches.open(CACHE);
  await cache.put(
    offlineKey(video.id),
    new Response(blob, {headers: {"Content-Type": "video/mp4", "Content-Length": String(blob.size)}}),
  );
  const entry: SavedLesson = {
    id: video.id,
    title: video.title,
    url: source.url,
    bytes: blob.size,
    poster: video.poster,
    duration_seconds: video.duration_seconds,
    course,
    savedAt: new Date().toISOString(),
  };
  writeIndex([entry, ...readIndex().filter((lesson) => lesson.id !== video.id)]);
  return entry;
}

export async function removeLesson(id: number) {
  try {
    const cache = await caches.open(CACHE);
    await cache.delete(offlineKey(id));
  } catch {
    // Already gone.
  }
  writeIndex(readIndex().filter((lesson) => lesson.id !== id));
}

/** A blob: address for a saved lesson, or null. Revoke it when done. */
export async function offlineUrl(id: number): Promise<string | null> {
  if (!canSaveOffline()) return null;
  try {
    const cache = await caches.open(CACHE);
    const response = await cache.match(offlineKey(id));
    if (!response) return null;
    return URL.createObjectURL(await response.blob());
  } catch {
    return null;
  }
}

/** Cache keys are requests, so each lesson gets a stable made-up address. */
function offlineKey(id: number) {
  return `/__offline-lessons__/${id}.mp4`;
}

// --------------------------------------------------------------------------
// For components: the list, kept in step with other tabs, with no effect.

let cachedRaw: string | null | undefined;
let cached: SavedLesson[] = [];

function snapshot(): SavedLesson[] {
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(INDEX);
  } catch {
    raw = null;
  }
  if (raw !== cachedRaw) {
    cachedRaw = raw;
    cached = readIndex();
  }
  return cached;
}

const nothing = () => () => {};

/** The saved lessons, or null while rendering on the server. */
export function useSavedLessons(): SavedLesson[] | null {
  return useSyncExternalStore(onSavedChange, snapshot, () => null);
}

/** Whether this browser can keep lessons at all. False on the server. */
export function useCanSaveOffline(): boolean {
  return useSyncExternalStore(nothing, canSaveOffline, () => false);
}
