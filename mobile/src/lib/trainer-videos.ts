/**
 * A trainer's teaching videos, from the app: the API, the phone's file, and
 * which file each unfinished upload came from.
 *
 * The endpoints are the website's (backend/providers/trainer_videos.py).
 * They take the app's sign-in token as they are: AppTokenMiddleware makes
 * the token the signed-in user before DRF's SessionAuthentication looks, and
 * excuses it the CSRF check (backend/accounts/app_auth.py).
 *
 * A video is chosen from the phone's gallery (expo-image-picker) or its
 * files (expo-file-system's picker). The gallery is what trainers know, but
 * on Android it copies the video into the app's cache before handing it
 * over: for a 2 GB lesson, 2 GB more on the phone and a wait. That copy is
 * deleted once the upload is finished, cancelled or removed (forgetFile).
 * The file picker hands back the file itself, keeps permission to read it
 * after the app is closed, and needs no room, so it stays as the second way.
 * Either is read 2 MB at a time.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import { fetch as expoFetch } from "expo/fetch";
import { Directory, File, FileMode, Paths } from "expo-file-system";
import * as ImagePicker from "expo-image-picker";

import { ApiError, getJson, postJson, request } from "./api";
import { API_URL } from "./config";
import { token } from "./session";
import { mayOpenGallery } from "./store-rules";
import { videoNameFrom, type PieceSource } from "./video-upload";

export type TrainerVideoStatus =
  | "uploading"
  | "queued"
  | "processing"
  | "failed"
  | "pending"
  | "approved"
  | "rejected";

/** One of the trainer's own videos, with where it stands. */
export type TrainerVideo = {
  id: number;
  title: string;
  kind: "upload" | "youtube";
  youtube_id: string;
  status: TrainerVideoStatus;
  /** Why it was turned down, written for the trainer to act on. */
  review_note: string;
  /** Why it could not be prepared, likewise. */
  failure_reason: string;
  /** The file's name when it was chosen, or "" (the app's file picker gives none; its gallery does). */
  upload_name: string;
  upload_size: number | null;
  upload_received: number;
  duration_seconds: number | null;
  /** Only once approved: before then the files are private. */
  poster: string | null;
  created_at: string;
};

/** The allowances, from backend/providers/videos.py limits(). */
export type TrainerVideoLimits = {
  max_videos: number;
  max_minutes: number;
  max_hours: number;
  max_upload_bytes: number;
  chunk_bytes: number;
  seconds_used: number;
  /** False while the server cannot take uploads (its video disk is nearly full). */
  accepting?: boolean;
  /** True when a video goes on the listing as soon as it is prepared, and staff watch it afterwards. */
  publishes_straight_away?: boolean;
  /** True when this trainer is back to review-first because staff removed two of their videos. */
  review_first_because_blocked?: boolean;
  /** Approved videos a new workshop needs before its videos go on without waiting. */
  trusted_after?: number;
  /** How many it has: watched and approved by staff. */
  approved_count?: number;
};

export type TrainerVideoList = { videos: TrainerVideo[]; limits: TrainerVideoLimits };

/** The parts of the trainer's own listing this screen needs. */
export type TrainerListing = {
  authenticated: boolean;
  profile: {
    status: string;
    programme: { trade: { slug: string } | null } | null;
  } | null;
};

const VIDEOS = "/api/trainer/profile/videos/";

export const trainerVideos = {
  list: () => getJson<TrainerVideoList>(VIDEOS),
  /** Whether there is a listing yet, whether it is live, and its trade. */
  listing: () => getJson<TrainerListing>("/api/trainer/session/me/"),
  /**
   * Say what is coming. Refused now, before any data is spent, if it would
   * not fit, or without the trainer's word that it follows the guidelines.
   */
  start: (title: string, file: PickedVideo, agreedToGuidelines: boolean) =>
    postJson<TrainerVideo>(VIDEOS, {
      title,
      name: file.name,
      size: file.size,
      content_type: file.type ?? "",
      agreed_to_guidelines: agreedToGuidelines,
    }),
  /** Remove a video at any stage; for one still arriving, that is "cancel". */
  remove: (id: number) => request<null>("DELETE", `${VIDEOS}${id}/`),
};

/**
 * One piece of the file, starting at `offset`. See lib/video-upload.ts.
 *
 * expo/fetch rather than the app's usual request(): it hands the bytes to
 * the phone's own HTTP client as they are, where React Native's fetch would
 * turn every 2 MB piece into text first.
 */
export async function sendVideoPiece(
  videoId: number,
  offset: number,
  piece: Uint8Array<ArrayBuffer>,
  signal?: AbortSignal,
): Promise<TrainerVideo> {
  const headers: Record<string, string> = {
    Accept: "application/json",
    "Content-Type": "application/octet-stream",
    "Upload-Offset": String(offset),
    "X-Fliptech-Client": "app",
  };
  const signedIn = token();
  if (signedIn) headers.Authorization = `Bearer ${signedIn}`;
  let response: Awaited<ReturnType<typeof expoFetch>>;
  try {
    response = await expoFetch(`${API_URL}${VIDEOS}${videoId}/upload/`, { method: "PUT", headers, body: piece, signal });
  } catch {
    throw new ApiError("No connection. Check your data or Wi-Fi and try again.", 0);
  }
  const data: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const detail = (data as { detail?: unknown } | null)?.detail;
    const message =
      typeof detail === "string"
        ? detail
        : response.status >= 500
          ? "Something went wrong on our side. Try again in a minute."
          : "That did not work. Check and try again.";
    throw new ApiError(message, response.status, {}, data);
  }
  return data as TrainerVideo;
}

/** A video chosen on the phone: where it is, how big, and what the phone says it is. */
export type PickedVideo = { uri: string; name: string; size: number; type: string | null };

/**
 * The phone's gallery, showing videos. Null when the trainer backs out,
 * "denied" when the phone will not let the app see them.
 *
 * On Android 13 and later the gallery needs no permission (the permission
 * call answers yes at once); before that it asks for the storage access the
 * image picker already declares. An iPhone asks nothing (lib/store-rules.ts,
 * mayOpenGallery), and hands over the video as it was filmed, often a .MOV,
 * without converting it first: the server takes .mov.
 */
export async function pickFromGallery(): Promise<PickedVideo | "denied" | null> {
  if (!(await mayOpenGallery())) return "denied";
  const picked = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["videos"], allowsEditing: false });
  const asset = picked.canceled ? null : picked.assets[0];
  if (!asset) return null;
  // The size of the copy, which is what is sent; the gallery's own figure if
  // the copy cannot be measured.
  let size = asset.fileSize ?? 0;
  try {
    size = new File(asset.uri).size || size;
  } catch {
    // Measured by the gallery instead.
  }
  return { uri: asset.uri, name: asset.fileName ?? videoNameFrom(asset.uri), size, type: asset.mimeType ?? null };
}

/** The phone's file picker, showing videos. Null when the trainer backs out. */
export async function pickFromFiles(): Promise<PickedVideo | null> {
  const picked = await File.pickFileAsync({ mimeTypes: "video/*" });
  if (picked.canceled) return null;
  const file = picked.result;
  return { uri: file.uri, name: videoNameFrom(file.uri), size: file.size, type: file.type || null };
}

/** A local path from a file:// URI, without the scheme or a trailing slash. */
function pathOf(uri: string) {
  let path = uri.replace(/^file:\/*/, "/");
  try {
    path = decodeURI(path);
  } catch {
    // Kept as it is.
  }
  return path.replace(/\/+$/, "");
}

/** Where the image picker puts its copies: the app's cache, in "ImagePicker" (Android and iPhone alike). */
function galleryCopies() {
  return new Directory(Paths.cache, "ImagePicker");
}

/**
 * Videos, by file ending: Android's copies are .mp4; an iPhone keeps the
 * original's ending, usually .MOV. Pictures pass through the same folder and
 * are never touched.
 */
const VIDEO_ENDING = /\.(mp4|mov|m4v|3gp|webm|mkv)$/i;

/**
 * Whether `uri` is the image picker's copy of a gallery video, which the app
 * made and may delete. Anything else (the trainer's own file, a content://
 * address) is never deleted.
 */
export function isGalleryCopy(uri: string) {
  if (!uri.startsWith("file:") || !VIDEO_ENDING.test(uri)) return false;
  try {
    return pathOf(uri).startsWith(`${pathOf(galleryCopies().uri)}/`);
  } catch {
    return false;
  }
}

/** Delete the gallery copy at `uri`, if it is one. Never throws. */
export function discardCopy(uri: string | undefined) {
  if (!uri || !isGalleryCopy(uri)) return;
  try {
    const file = new File(uri);
    if (file.exists) file.delete();
  } catch {
    // Already gone, or the phone cleared its cache.
  }
}

/**
 * Delete gallery video copies left behind (the app closed between choosing
 * and sending), keeping those in `keep`. Only videos: the profile photo and
 * product photos pass through the same folder, as pictures.
 */
export function discardCopiesExcept(keep: string[]) {
  const wanted = new Set(keep.map(pathOf));
  try {
    const folder = galleryCopies();
    if (!folder.exists) return;
    for (const entry of folder.list()) {
      if (entry instanceof File && isGalleryCopy(entry.uri) && !wanted.has(pathOf(entry.uri))) discardCopy(entry.uri);
    }
  } catch {
    // Nothing to tidy, or not allowed: the phone clears its cache itself.
  }
}

/**
 * The chosen file, opened for reading a piece at a time. Throws when the
 * phone no longer lets the app read it (moved, deleted, or permission gone):
 * the trainer then chooses it again.
 */
export function openVideo(uri: string): PieceSource & { close: () => void } {
  const file = new File(uri);
  // A gallery copy the phone cleared from the cache to make room.
  if (uri.startsWith("file:") && !file.exists) throw new Error("The video is no longer on the phone.");
  const handle = file.open(FileMode.ReadOnly);
  return {
    size: handle.size ?? file.size,
    async read(offset, length) {
      handle.offset = offset;
      return handle.readBytes(length);
    },
    close: () => {
      try {
        handle.close();
      } catch {
        // Already closed.
      }
    },
  };
}

/**
 * Which file each unfinished upload is coming from, kept on the phone, so an
 * upload stopped by the app closing carries on without choosing it again.
 */
export type RememberedFiles = Record<string, { uri: string; size: number }>;

const FILES_KEY = "trainer-video-files";

async function readFiles(): Promise<RememberedFiles> {
  try {
    const saved = await AsyncStorage.getItem(FILES_KEY);
    return saved ? (JSON.parse(saved) as RememberedFiles) : {};
  } catch {
    return {};
  }
}

async function saveFiles(files: RememberedFiles) {
  try {
    await AsyncStorage.setItem(FILES_KEY, JSON.stringify(files));
  } catch {
    // A full phone: the trainer chooses the file again to carry on.
  }
}

// One change at a time: each reads the record, changes it and writes it
// back, and two at once would lose one of them.
let queue: Promise<unknown> = Promise.resolve();
function inTurn<T>(change: () => Promise<T>): Promise<T> {
  const next = queue.then(change, change);
  queue = next.catch(() => undefined);
  return next;
}

export function rememberedFiles() {
  return inTurn(readFiles);
}

export function rememberFile(videoId: number, uri: string, size: number) {
  return inTurn(async () => {
    const files = await readFiles();
    const before = files[String(videoId)]?.uri;
    if (before && before !== uri) discardCopy(before);
    files[String(videoId)] = { uri, size };
    await saveFiles(files);
    return files;
  });
}

/** Forget an upload's file: finished, cancelled, removed, or no longer readable. A gallery copy is deleted. */
export function forgetFile(videoId: number) {
  return inTurn(async () => {
    const files = await readFiles();
    discardCopy(files[String(videoId)]?.uri);
    delete files[String(videoId)];
    await saveFiles(files);
    return files;
  });
}

/**
 * Forget every file but those of the uploads in `keep` (still arriving): the
 * others finished, or were removed on the website. Their gallery copies go.
 */
export function forgetFilesExcept(keep: number[]) {
  return inTurn(async () => {
    const files = await readFiles();
    const wanted = new Set(keep.map(String));
    const kept = Object.fromEntries(Object.entries(files).filter(([id]) => wanted.has(id)));
    for (const [id, file] of Object.entries(files)) if (!wanted.has(id)) discardCopy(file.uri);
    if (Object.keys(kept).length !== Object.keys(files).length) await saveFiles(kept);
    return kept;
  });
}
