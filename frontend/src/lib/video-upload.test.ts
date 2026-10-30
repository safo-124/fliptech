import {afterEach, describe, expect, it, vi} from "vitest";

import {sendVideoPiece} from "./trainer-api";
import {TrainerApiError} from "./trainer-fetch";
import type {TrainerVideo} from "./types";
import {UploadPaused, sameFile, sendFile} from "./video-upload";

vi.mock("./trainer-api", () => ({sendVideoPiece: vi.fn()}));
const send = vi.mocked(sendVideoPiece);

function video(fields: Partial<TrainerVideo> = {}): TrainerVideo {
  return {
    id: 7,
    title: "Cornrows",
    kind: "upload",
    youtube_id: "",
    duration_seconds: null,
    poster: null,
    sources: [],
    status: "uploading",
    review_note: "",
    failure_reason: "",
    upload_name: "lesson.mp4",
    upload_size: 10,
    upload_received: 0,
    created_at: "2026-10-30T00:00:00Z",
    ...fields,
  };
}

const file = new File(["0123456789"], "lesson.mp4");
const noWait: (ms: number) => Promise<void> = () => Promise.resolve();

/** A server that takes whatever arrives at the right offset. */
function acceptingServer() {
  let received = 0;
  send.mockImplementation(async (_id, offset, piece) => {
    if (offset !== received) {
      throw new TrainerApiError("out of place", 409, {}, {upload_received: received});
    }
    received += piece.size;
    return video({upload_received: received, status: received === 10 ? "queued" : "uploading"});
  });
}

afterEach(() => send.mockReset());

describe("sendFile", () => {
  it("sends the file in pieces, each saying where it starts", async () => {
    acceptingServer();
    const progress: number[] = [];

    const done = await sendFile(video(), file, {chunkBytes: 4, onProgress: (n) => progress.push(n)});

    expect(send.mock.calls.map(([, offset, piece]) => [offset, piece.size])).toEqual([
      [0, 4],
      [4, 4],
      [8, 2],
    ]);
    expect(progress).toEqual([4, 8, 10]);
    expect(done.status).toBe("queued");
  });

  it("carries on from where an interrupted upload stopped", async () => {
    // The server already has 6 bytes from an earlier visit.
    let received = 6;
    send.mockImplementation(async (_id, offset, piece) => {
      expect(offset).toBe(received);
      received += piece.size;
      return video({upload_received: received});
    });

    await sendFile(video({upload_received: 6}), file, {chunkBytes: 4, onProgress: () => {}});

    expect(send.mock.calls[0][1]).toBe(6);
  });

  it("goes where the server says when a piece is refused as out of place", async () => {
    let calls = 0;
    send.mockImplementation(async (_id, offset, piece) => {
      calls += 1;
      // The first answer was lost: the server has 4 bytes, the page thinks 0.
      if (calls === 1) throw new TrainerApiError("out of place", 409, {}, {upload_received: 4});
      return video({upload_received: offset + piece.size});
    });

    await sendFile(video(), file, {chunkBytes: 4, onProgress: () => {}});

    expect(send.mock.calls.map(([, offset]) => offset)).toEqual([0, 4, 8]);
  });

  it("does not go round for ever when told the same offset twice", async () => {
    send.mockRejectedValue(new TrainerApiError("stuck", 409, {}, {upload_received: 0}));

    await expect(sendFile(video(), file, {chunkBytes: 4, onProgress: () => {}})).rejects.toThrow(
      "stuck",
    );
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("retries a piece the network dropped, then pauses keeping what was sent", async () => {
    let calls = 0;
    send.mockImplementation(async () => {
      calls += 1;
      if (calls === 1) return video({upload_received: 4});
      throw new TrainerApiError("offline", 0);
    });
    const wait = vi.fn(noWait);

    const sending = sendFile(video(), file, {chunkBytes: 4, onProgress: () => {}, wait});

    await expect(sending).rejects.toEqual(new UploadPaused(4));
    await expect(sending).rejects.toMatchObject({received: 4});
    expect(wait.mock.calls.map(([ms]) => ms)).toEqual([1000, 2000, 4000, 8000, 16000, 30000]);
  });

  it("stops on a refusal that retrying would not change", async () => {
    send.mockRejectedValue(new TrainerApiError("Not found.", 404));

    await expect(sendFile(video(), file, {chunkBytes: 4, onProgress: () => {}})).rejects.toThrow(
      "Not found.",
    );
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("pauses when asked to", async () => {
    const controller = new AbortController();
    send.mockImplementation(async (_id, offset, piece) => {
      controller.abort();
      return video({upload_received: offset + piece.size});
    });

    await expect(
      sendFile(video(), file, {chunkBytes: 4, onProgress: () => {}, signal: controller.signal}),
    ).rejects.toMatchObject({received: 4});
  });
});

describe("sameFile", () => {
  it("recognises the file an upload was started with", () => {
    expect(sameFile(video(), file)).toBe(true);
    expect(sameFile(video({upload_size: 11}), file)).toBe(false);
    expect(sameFile(video({upload_name: "other.mp4"}), file)).toBe(false);
  });
});
