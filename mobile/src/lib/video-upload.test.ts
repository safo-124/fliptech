import { ApiError } from "./api";
import {
  UploadPaused,
  formatBytes,
  isVideoFile,
  percentSent,
  sameFile,
  sendFile,
  videoNameFrom,
  type PieceSource,
  type UploadingVideo,
} from "./video-upload";

type Video = UploadingVideo & { status: string };

const video = (fields: Partial<Video> = {}): Video => ({ id: 7, upload_received: 0, status: "uploading", ...fields });

/** Ten bytes on the "phone", read a piece at a time like the real file. */
const BYTES = new TextEncoder().encode("0123456789");
const reads: [number, number][] = [];
const file: PieceSource = {
  size: BYTES.length,
  read: async (offset, length) => {
    reads.push([offset, length]);
    return BYTES.slice(offset, offset + length);
  },
};

const noWait: (ms: number) => Promise<void> = () => Promise.resolve();

const send = jest.fn<Promise<Video>, [number, number, Uint8Array, AbortSignal?]>();

/** A server that takes whatever arrives at the right offset. */
function acceptingServer() {
  let received = 0;
  send.mockImplementation(async (_id, offset, piece) => {
    if (offset !== received) throw new ApiError("out of place", 409, {}, { upload_received: received });
    received += piece.length;
    return video({ upload_received: received, status: received === 10 ? "queued" : "uploading" });
  });
}

afterEach(() => {
  send.mockReset();
  reads.length = 0;
});

describe("sendFile", () => {
  it("sends the file in pieces, each saying where it starts, reading only that piece", async () => {
    acceptingServer();
    const progress: number[] = [];

    const done = await sendFile(video(), file, { chunkBytes: 4, sendPiece: send, onProgress: (n) => progress.push(n) });

    expect(send.mock.calls.map(([, offset, piece]) => [offset, piece.length])).toEqual([
      [0, 4],
      [4, 4],
      [8, 2],
    ]);
    expect(reads).toEqual([
      [0, 4],
      [4, 4],
      [8, 2],
    ]);
    expect(progress).toEqual([4, 8, 10]);
    expect(done.status).toBe("queued");
  });

  it("carries on from where an interrupted upload stopped", async () => {
    // The server already has 6 bytes, from before the app was closed.
    let received = 6;
    send.mockImplementation(async (_id, offset, piece) => {
      expect(offset).toBe(received);
      received += piece.length;
      return video({ upload_received: received });
    });

    await sendFile(video({ upload_received: 6 }), file, { chunkBytes: 4, sendPiece: send, onProgress: () => {} });

    expect(send.mock.calls[0][1]).toBe(6);
    expect(new TextDecoder().decode(send.mock.calls[0][2])).toBe("6789");
  });

  it("goes where the server says when a piece is refused as out of place", async () => {
    let calls = 0;
    send.mockImplementation(async (_id, offset, piece) => {
      calls += 1;
      // The first answer was lost: the server has 4 bytes, the app thinks 0.
      if (calls === 1) throw new ApiError("out of place", 409, {}, { upload_received: 4 });
      return video({ upload_received: offset + piece.length });
    });

    await sendFile(video(), file, { chunkBytes: 4, sendPiece: send, onProgress: () => {} });

    expect(send.mock.calls.map(([, offset]) => offset)).toEqual([0, 4, 8]);
  });

  it("does not go round for ever when told the same offset twice", async () => {
    send.mockRejectedValue(new ApiError("stuck", 409, {}, { upload_received: 0 }));

    await expect(sendFile(video(), file, { chunkBytes: 4, sendPiece: send, onProgress: () => {} })).rejects.toThrow(
      "stuck",
    );
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("retries a piece the network dropped, then pauses keeping what was sent", async () => {
    let calls = 0;
    send.mockImplementation(async () => {
      calls += 1;
      if (calls === 1) return video({ upload_received: 4 });
      throw new ApiError("No connection.", 0);
    });
    const wait = jest.fn(noWait);

    const sending = sendFile(video(), file, { chunkBytes: 4, sendPiece: send, onProgress: () => {}, wait });

    await expect(sending).rejects.toEqual(new UploadPaused(4));
    await expect(sending).rejects.toMatchObject({ received: 4 });
    expect(wait.mock.calls.map(([ms]) => ms)).toEqual([1000, 2000, 4000, 8000, 16000, 30000]);
  });

  it("retries when the server has a moment, and carries on", async () => {
    let calls = 0;
    send.mockImplementation(async (_id, offset, piece) => {
      calls += 1;
      if (calls === 2) throw new ApiError("Bad gateway", 502);
      return video({ upload_received: offset + piece.length });
    });

    const done = await sendFile(video(), file, { chunkBytes: 4, sendPiece: send, onProgress: () => {}, wait: noWait });

    expect(done.upload_received).toBe(10);
    expect(send.mock.calls.map(([, offset]) => offset)).toEqual([0, 4, 4, 8]);
  });

  it("stops on a refusal that retrying would not change", async () => {
    send.mockRejectedValue(new ApiError("Not found.", 404));

    await expect(sendFile(video(), file, { chunkBytes: 4, sendPiece: send, onProgress: () => {} })).rejects.toThrow(
      "Not found.",
    );
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("pauses when asked to, between pieces", async () => {
    const controller = new AbortController();
    send.mockImplementation(async (_id, offset, piece) => {
      controller.abort();
      return video({ upload_received: offset + piece.length });
    });

    await expect(
      sendFile(video(), file, { chunkBytes: 4, sendPiece: send, onProgress: () => {}, signal: controller.signal }),
    ).rejects.toMatchObject({ received: 4 });
  });

  it("pauses when asked to while a piece is in the air, keeping the last offset", async () => {
    const controller = new AbortController();
    let calls = 0;
    send.mockImplementation(async (_id, offset, piece) => {
      calls += 1;
      if (calls === 2) {
        controller.abort();
        throw new Error("Aborted");
      }
      return video({ upload_received: offset + piece.length });
    });

    const sending = sendFile(video(), file, {
      chunkBytes: 4,
      sendPiece: send,
      onProgress: () => {},
      signal: controller.signal,
    });

    await expect(sending).rejects.toBeInstanceOf(UploadPaused);
    await expect(sending).rejects.toMatchObject({ received: 4 });
  });

  it("passes the pause signal on to each piece, so the request itself stops", async () => {
    acceptingServer();
    const controller = new AbortController();

    await sendFile(video(), file, { chunkBytes: 4, sendPiece: send, onProgress: () => {}, signal: controller.signal });

    expect(send.mock.calls.every(([, , , signal]) => signal === controller.signal)).toBe(true);
  });
});

describe("helpers", () => {
  it("recognises the file an upload was started with, by its size", () => {
    expect(sameFile({ upload_size: 10 }, 10)).toBe(true);
    expect(sameFile({ upload_size: 11 }, 10)).toBe(false);
    expect(sameFile({ upload_size: null }, 10)).toBe(false);
  });

  it("knows a video by its type, or by its name when there is no type", () => {
    expect(isVideoFile("video/mp4")).toBe(true);
    expect(isVideoFile("image/jpeg", "lesson.mp4")).toBe(false);
    expect(isVideoFile(null, "lesson.MOV")).toBe(true);
    expect(isVideoFile("", "photo.jpg")).toBe(false);
  });

  it("finds the file's name in a picked address only when there is one", () => {
    expect(videoNameFrom("content://com.android.providers.media.documents/document/video%3A1000012345")).toBe("");
    expect(
      videoNameFrom("content://com.android.externalstorage.documents/document/primary%3ADCIM%2FCamera%2FVID_20261122.mp4"),
    ).toBe("VID_20261122.mp4");
    expect(videoNameFrom("file:///data/user/0/com.fliiptech/cache/lesson%201.MOV")).toBe("lesson 1.MOV");
    expect(videoNameFrom("content://x/document/photo.jpg")).toBe("");
    expect(videoNameFrom("content://x/document/bad%E0%A4%A.mp4")).toBe("bad%E0%A4%A.mp4");
  });

  it("writes sizes as the website does", () => {
    expect(formatBytes(4 * 1024 ** 3)).toBe("4.0 GB");
    expect(formatBytes(340 * 1024 ** 2)).toBe("340 MB");
    expect(formatBytes(10)).toBe("1 KB");
  });

  it("gives whole percents, never over 100", () => {
    expect(percentSent(1, 3)).toBe(33);
    expect(percentSent(5, 5)).toBe(100);
    expect(percentSent(6, 5)).toBe(100);
    expect(percentSent(3, null)).toBe(0);
  });
});
