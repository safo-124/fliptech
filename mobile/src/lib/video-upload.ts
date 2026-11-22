/**
 * Sending a teaching video to the server a piece at a time, from the phone.
 *
 * The same protocol as the website (frontend/src/lib/video-upload.ts): an
 * hour of teaching is gigabytes on 3G, so the file goes in pieces the server
 * sizes (2 MB), each saying where it starts. A dropped connection costs one
 * piece, and an upload interrupted for any reason (no signal, the phone
 * locked, the app closed) carries on from where the server says it got to.
 * See backend/providers/video_uploads.py for the server's half.
 *
 * Nothing here touches the phone's files or the network directly: the file
 * comes in as a `PieceSource` and pieces go out through `sendPiece`, so this
 * is the part the tests can drive. lib/trainer-videos.ts supplies both.
 */

import { ApiError } from "./api";

/** Retries for a piece that failed on the network, before pausing for now. */
const MAX_RETRIES = 6;

/** The fields of a trainer's video this module needs. */
export type UploadingVideo = { id: number; upload_received: number };

/** The chosen file, read a piece at a time so a 2 GB video is never in memory. */
export type PieceSource = {
  size: number;
  read: (offset: number, length: number) => Promise<Uint8Array<ArrayBuffer>>;
};

export type SendPiece<V extends UploadingVideo> = (
  videoId: number,
  offset: number,
  piece: Uint8Array<ArrayBuffer>,
  signal?: AbortSignal,
) => Promise<V>;

export class UploadPaused extends Error {
  constructor(readonly received: number) {
    super("Upload paused");
  }
}

type Options<V extends UploadingVideo> = {
  chunkBytes: number;
  sendPiece: SendPiece<V>;
  onProgress: (received: number) => void;
  signal?: AbortSignal;
  /** For tests: how to wait between retries. */
  wait?: (ms: number) => Promise<void>;
};

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function receivedFrom(reason: unknown): number | null {
  if (!(reason instanceof ApiError) || reason.status !== 409) return null;
  const body = reason.body as { upload_received?: unknown } | null;
  return typeof body?.upload_received === "number" ? body.upload_received : null;
}

/** Worth trying the same piece again: the network, or the server having a moment. */
function retryable(reason: unknown) {
  return reason instanceof ApiError && (reason.status === 0 || reason.status >= 500);
}

/**
 * Send what is left of `source`, from where the server says it has got to.
 *
 * Resolves with the video once the last piece is in. Rejects with
 * UploadPaused when the network stays down or the caller aborts: everything
 * sent so far is kept, and calling this again carries on from there.
 */
export async function sendFile<V extends UploadingVideo>(
  video: V,
  source: PieceSource,
  { chunkBytes, sendPiece, onProgress, signal, wait = sleep }: Options<V>,
): Promise<V> {
  let latest = video;
  let offset = video.upload_received;
  let failures = 0;
  let lastRefusedAt: number | null = null;

  while (offset < source.size) {
    if (signal?.aborted) throw new UploadPaused(offset);
    try {
      const piece = await source.read(offset, Math.min(chunkBytes, source.size - offset));
      latest = await sendPiece(video.id, offset, piece, signal);
      offset = latest.upload_received;
      failures = 0;
      lastRefusedAt = null;
      onProgress(offset);
    } catch (reason) {
      // Paused by hand while a piece was in the air: the piece is dropped,
      // and the server's offset is where the next attempt starts.
      if (signal?.aborted) throw new UploadPaused(offset);
      const received = receivedFrom(reason);
      // The server has a different idea of where the file has got to: a
      // piece that arrived but whose answer was lost, usually. It says where
      // to carry on. Told the same twice running means something else is
      // wrong, and going round again would never end.
      if (received !== null && received !== lastRefusedAt) {
        lastRefusedAt = received;
        offset = received;
        onProgress(offset);
        continue;
      }
      if (retryable(reason) && failures < MAX_RETRIES) {
        failures += 1;
        // 1, 2, 4, 8, 16, 30 seconds: long enough for a phone to find its
        // signal again, short enough that nobody thinks it has stopped.
        await wait(Math.min(1000 * 2 ** (failures - 1), 30_000));
        continue;
      }
      if (retryable(reason)) throw new UploadPaused(offset);
      throw reason;
    }
  }
  return latest;
}

/**
 * Whether a file picked again is the one an interrupted upload was started
 * with. By size to the byte: the phone's picker does not tell the app a
 * file's own name, and two different lessons of exactly the same size do not
 * happen.
 */
export function sameFile(video: { upload_size: number | null }, size: number) {
  return video.upload_size === size;
}

const VIDEO_EXTENSIONS = /\.(mp4|m4v|mov|3gp|3g2|webm|mkv|avi|mpe?g|ts|wmv)$/i;

/** A video by its type, or by its name when the phone gives no type. */
export function isVideoFile(type: string | null | undefined, name = "") {
  if (type) return type.startsWith("video/");
  return VIDEO_EXTENSIONS.test(name);
}

/**
 * The file's own name, when its address carries one, or "".
 *
 * Android's picker hands back an address, not a name: usually an id
 * (content://…/document/video%3A1000012345), sometimes a path
 * (…/document/primary%3ADCIM%2FCamera%2FVID_20261122.mp4). Only a name that
 * looks like a video file is kept; an id is no use to the trainer, and the
 * server would refuse a name with the wrong ending.
 */
export function videoNameFrom(uri: string) {
  const last = uri.split("?")[0].split("/").pop() ?? "";
  let decoded = last;
  try {
    decoded = decodeURIComponent(last);
  } catch {
    // A stray % in the address: use it as it is.
  }
  const name = decoded.split(/[/:]/).pop() ?? "";
  return VIDEO_EXTENSIONS.test(name) ? name.slice(0, 255) : "";
}

/** 1.2 GB, 340 MB, 12 KB: as the website shows sizes. */
export function formatBytes(bytes: number) {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  if (bytes >= 1024 ** 2) return `${Math.round(bytes / 1024 ** 2)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/** How much of an upload has arrived, as a whole percent, never over 100. */
export function percentSent(received: number, total: number | null) {
  if (!total) return 0;
  return Math.min(100, Math.floor((received / total) * 100));
}
