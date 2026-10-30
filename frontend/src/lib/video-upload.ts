/**
 * Sending a video file to the server a piece at a time.
 *
 * An hour of teaching is gigabytes, sent from a phone on 3G. One request
 * would take most of an hour and start again from nothing the first time the
 * signal dropped. So the file goes in pieces (the server says how big), each
 * one saying where it starts, and a dropped connection costs one piece. See
 * backend/providers/video_uploads.py for the server's half.
 *
 * Nothing here holds the file in memory: File.slice() reads each piece from
 * the phone's storage as it is sent.
 */

import {sendVideoPiece} from "./trainer-api";
import {TrainerApiError} from "./trainer-fetch";
import type {TrainerVideo} from "./types";

/** Retries for a piece that failed on the network, before giving up for now. */
const MAX_RETRIES = 6;

export class UploadPaused extends Error {
  constructor(readonly received: number) {
    super("Upload paused");
  }
}

type Options = {
  chunkBytes: number;
  onProgress: (received: number) => void;
  signal?: AbortSignal;
  /** For tests: how to wait between retries. */
  wait?: (ms: number) => Promise<void>;
};

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function receivedFrom(reason: unknown): number | null {
  if (!(reason instanceof TrainerApiError) || reason.status !== 409) return null;
  const body = reason.body as {upload_received?: unknown} | null;
  return typeof body?.upload_received === "number" ? body.upload_received : null;
}

/** Worth trying the same piece again: the network, or the server having a moment. */
function retryable(reason: unknown) {
  return reason instanceof TrainerApiError && (reason.status === 0 || reason.status >= 500);
}

/**
 * Send what is left of `file`, from where the server says it has got to.
 *
 * Resolves with the video once the last piece is in. Rejects with
 * UploadPaused when the network stays down or the caller aborts: everything
 * sent so far is kept, and calling this again carries on from there.
 */
export async function sendFile(
  video: TrainerVideo,
  file: File,
  {chunkBytes, onProgress, signal, wait = sleep}: Options,
): Promise<TrainerVideo> {
  let latest = video;
  let offset = video.upload_received;
  let failures = 0;
  let lastRefusedAt: number | null = null;

  while (offset < file.size) {
    if (signal?.aborted) throw new UploadPaused(offset);
    try {
      latest = await sendVideoPiece(video.id, offset, file.slice(offset, offset + chunkBytes));
      offset = latest.upload_received;
      failures = 0;
      lastRefusedAt = null;
      onProgress(offset);
    } catch (reason) {
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

/** Whether `file` is the one an interrupted upload was started with. */
export function sameFile(video: TrainerVideo, file: File) {
  return video.upload_size === file.size && (!video.upload_name || video.upload_name === file.name);
}
