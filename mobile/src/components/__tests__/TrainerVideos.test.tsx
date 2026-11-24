import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Slot } from "expo-router";
import { act, fireEvent, renderRouter, screen, waitFor } from "expo-router/testing-library";
import { SafeAreaProvider } from "react-native-safe-area-context";

import TrainerVideosScreen from "../../app/trainer/videos";
import { ApiError } from "../../lib/api";
import type { TrainerVideo, TrainerVideoLimits, TrainerVideoList } from "../../lib/trainer-videos";

// Rendering through the router takes a few seconds on a cold CI runner.
jest.setTimeout(30_000);

const metrics = { frame: { x: 0, y: 0, width: 360, height: 780 }, insets: { top: 24, left: 0, right: 0, bottom: 16 } };

jest.mock("@/lib/auth", () => ({
  useAuth: () => ({
    ready: true,
    signedIn: true,
    account: { phone: "+233240000601", display_name: "Vida" },
    roles: { trainee: null, seller: null, trainer: { href: "/trainer/dashboard", status: "approved" } },
  }),
}));

// Whether the phone has a connection, changeable from a test.
const mockOnline = { value: true, listeners: new Set<() => void>() };
jest.mock("@/lib/online", () => {
  const { useSyncExternalStore } = jest.requireActual<typeof import("react")>("react");
  return {
    useOnline: () =>
      useSyncExternalStore(
        (listener: () => void) => {
          mockOnline.listeners.add(listener);
          return () => mockOnline.listeners.delete(listener);
        },
        () => mockOnline.value,
      ),
  };
});
function setOnline(value: boolean) {
  mockOnline.value = value;
  mockOnline.listeners.forEach((listener) => listener());
}

jest.mock("@/lib/open", () => ({ openOnSite: jest.fn() }));
jest.mock("expo-keep-awake", () => ({
  activateKeepAwakeAsync: jest.fn(async () => undefined),
  deactivateKeepAwake: jest.fn(async () => undefined),
}));

// The phone's file and the network: the parts a test cannot have.
const mockApi = {
  list: jest.fn<Promise<TrainerVideoList>, []>(),
  listing: jest.fn(async () => ({
    authenticated: true,
    profile: { status: "published", programme: { trade: { slug: "hairdressing" } } },
  })),
  start: jest.fn(),
  remove: jest.fn(async (_id: number) => null),
};
const mockSendPiece = jest.fn();
const mockPickGallery = jest.fn();
const mockPickFiles = jest.fn();
const mockDiscard = jest.fn();
const mockFiles: Record<string, { uri: string; size: number }> = {};
const mockBytes = new TextEncoder().encode("0123456789");
const mockOpen = jest.fn();
function readableVideo() {
  return {
    size: mockBytes.length,
    read: async (offset: number, length: number) => mockBytes.slice(offset, offset + length),
    close: () => undefined,
  };
}

// Looked up when called: jest.mock runs before the consts above exist.
jest.mock("@/lib/trainer-videos", () => ({
  trainerVideos: {
    list: () => mockApi.list(),
    listing: () => mockApi.listing(),
    start: (...args: unknown[]) => mockApi.start(...args),
    remove: (id: number) => mockApi.remove(id),
  },
  sendVideoPiece: (...args: unknown[]) => mockSendPiece(...args),
  pickFromGallery: () => mockPickGallery(),
  pickFromFiles: () => mockPickFiles(),
  discardCopy: (uri: string | undefined) => mockDiscard(uri),
  discardCopiesExcept: () => undefined,
  openVideo: (uri: string) => mockOpen(uri),
  rememberedFiles: async () => ({ ...mockFiles }),
  rememberFile: async (id: number, uri: string, size: number) => {
    mockFiles[String(id)] = { uri, size };
    return { ...mockFiles };
  },
  forgetFile: async (id: number) => {
    delete mockFiles[String(id)];
    return { ...mockFiles };
  },
  forgetFilesExcept: async (keep: number[]) => {
    for (const id of Object.keys(mockFiles)) if (!keep.includes(Number(id))) delete mockFiles[id];
    return { ...mockFiles };
  },
}));

const GALLERY_COPY = "file:///data/user/0/app/cache/ImagePicker/1.mp4";
const AGREE = "This is my own video, everyone in it agreed to be filmed, and no child appears without a guardian.";

const LIMITS: TrainerVideoLimits = {
  max_videos: 40,
  max_minutes: 60,
  max_hours: 24,
  max_upload_bytes: 4 * 1024 ** 3,
  chunk_bytes: 4,
  seconds_used: 0,
  accepting: true,
  publishes_straight_away: true,
  review_first_because_blocked: false,
};

function video(fields: Partial<TrainerVideo> = {}): TrainerVideo {
  return {
    id: 7,
    title: "Cornrows",
    kind: "upload",
    youtube_id: "",
    status: "uploading",
    review_note: "",
    failure_reason: "",
    upload_name: "",
    upload_size: 10,
    upload_received: 0,
    duration_seconds: null,
    poster: null,
    created_at: "2026-11-22T00:00:00Z",
    ...fields,
  };
}

/** A server that takes whatever arrives at the right offset, starting from `received`. */
function acceptingServer(received = 0) {
  mockSendPiece.mockImplementation(async (_id: number, offset: number, piece: Uint8Array) => {
    if (offset !== received) throw new ApiError("out of place", 409, {}, { upload_received: received });
    received += piece.length;
    return video({ upload_received: received, status: received === 10 ? "queued" : "uploading" });
  });
}

async function open() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  function Layout() {
    return (
      <QueryClientProvider client={client}>
        <SafeAreaProvider initialMetrics={metrics}>
          <Slot />
        </SafeAreaProvider>
      </QueryClientProvider>
    );
  }
  return renderRouter(
    { _layout: Layout, "trainer/videos": TrainerVideosScreen, index: () => null },
    { initialUrl: "/trainer/videos" },
  );
}

async function press(text: string) {
  await act(async () => {
    await fireEvent.press(await screen.findByText(text));
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  setOnline(true);
  for (const id of Object.keys(mockFiles)) delete mockFiles[id];
  mockOpen.mockImplementation(readableVideo);
});

describe("a trainer's videos in the app", () => {
  it("says so up front when the server cannot take videos, as the website does", async () => {
    mockApi.list.mockResolvedValue({ videos: [], limits: { ...LIMITS, accepting: false } });

    await open();

    expect(
      await screen.findByText(
        "Videos cannot be uploaded right now. Your other videos are safe. Try again tomorrow, or contact Fliiptech.",
      ),
    ).toBeTruthy();
    expect(screen.queryByText("Send video")).toBeNull();
  });

  it.each([
    [
      "go live straight away",
      { publishes_straight_away: true, review_first_because_blocked: false },
      "Your videos appear on your listing as soon as they are ready. Fliiptech checks each one soon after and removes any that break the guidelines.",
    ],
    [
      "are watched first after two were removed",
      { publishes_straight_away: false, review_first_because_blocked: true },
      "Two of your videos were removed, so Fliiptech now watches each new video before it appears.",
    ],
    [
      "are watched first for everyone",
      { publishes_straight_away: false, review_first_because_blocked: false },
      "Fliiptech watches each video before it appears on your listing.",
    ],
    [
      "are watched first while the workshop is new",
      { publishes_straight_away: false, review_first_because_blocked: false, trusted_after: 3, approved_count: 1 },
      "Fliiptech watches your first 3 videos before they appear on your listing (1 approved so far). After that, new videos appear as soon as they are ready, and Fliiptech checks each one soon after.",
    ],
  ])("says above the form when videos %s", async (_case, publishing, line) => {
    mockApi.list.mockResolvedValue({ videos: [], limits: { ...LIMITS, ...publishing } });

    await open();

    expect(await screen.findByText(line)).toBeTruthy();
  });

  it("asks for a video, what it shows and the tick before starting anything", async () => {
    mockApi.list.mockResolvedValue({ videos: [], limits: LIMITS });
    await open();

    await press("Send video");

    expect(screen.getByText("Choose a video from your phone.")).toBeTruthy();
    expect(screen.getByText("Say what the video shows.")).toBeTruthy();
    expect(screen.getByText("Tick the box to confirm this video follows the guidelines.")).toBeTruthy();
    expect(mockApi.start).not.toHaveBeenCalled();

    // Ticking it takes the message away.
    await act(async () => {
      await fireEvent.press(screen.getByRole("checkbox", { name: AGREE }));
    });
    expect(screen.queryByText("Tick the box to confirm this video follows the guidelines.")).toBeNull();
  });

  it("refuses a video too large before any data is spent", async () => {
    mockApi.list.mockResolvedValue({ videos: [], limits: { ...LIMITS, max_upload_bytes: 5 } });
    mockPickFiles.mockResolvedValue({ uri: "content://media/video%3A1", name: "", size: 10 * 1024 ** 2, type: "video/mp4" });
    await open();

    await press("Choose from files");
    await fireEvent.changeText(screen.getByLabelText("What it shows"), "Cornrows");
    await act(async () => {
      await fireEvent.press(screen.getByRole("checkbox", { name: AGREE }));
    });
    await press("Send video");

    expect(
      screen.getByText("That video is 10 MB. Each lesson can be up to 1 KB: film at 720p, or split it into shorter lessons."),
    ).toBeTruthy();
    expect(mockApi.start).not.toHaveBeenCalled();
  });

  it("picks a video from the gallery and sends it in pieces, showing progress, until it is waiting to be prepared", async () => {
    mockApi.list.mockResolvedValue({ videos: [], limits: LIMITS });
    mockPickGallery.mockResolvedValue({ uri: GALLERY_COPY, name: "VID_1.mp4", size: 10, type: "video/mp4" });
    mockApi.start.mockResolvedValue(video({ upload_name: "VID_1.mp4" }));
    acceptingServer();
    await open();

    await press("Choose from gallery");
    expect(screen.getByText("Video chosen · 1 KB")).toBeTruthy();
    await fireEvent.changeText(screen.getByLabelText("What it shows"), "Cornrows");
    await act(async () => {
      await fireEvent.press(screen.getByRole("checkbox", { name: AGREE }));
    });
    await press("Send video");

    await waitFor(() => expect(screen.getByText("Waiting to be prepared")).toBeTruthy());
    expect(mockApi.start).toHaveBeenCalledWith(
      "Cornrows",
      expect.objectContaining({ uri: GALLERY_COPY, name: "VID_1.mp4", size: 10, type: "video/mp4" }),
      true,
    );
    expect(mockOpen).toHaveBeenCalledWith(GALLERY_COPY);
    expect(mockSendPiece.mock.calls.map(([, offset, piece]) => [offset, piece.length])).toEqual([
      [0, 4],
      [4, 4],
      [8, 2],
    ]);
    // Done: the file is forgotten (lib/trainer-videos deletes the gallery copy then)…
    expect(mockFiles).toEqual({});
    // …and the screen did not delete it while it was still being sent.
    expect(mockDiscard).not.toHaveBeenCalledWith(GALLERY_COPY);
    // The next video needs its own tick.
    expect(screen.getByRole("checkbox", { name: AGREE }).props.accessibilityState).toEqual({ checked: false });
  });

  it("shows the server's guidelines message under the box", async () => {
    mockApi.list.mockResolvedValue({ videos: [], limits: LIMITS });
    mockPickGallery.mockResolvedValue({ uri: GALLERY_COPY, name: "VID_1.mp4", size: 10, type: "video/mp4" });
    mockApi.start.mockRejectedValue(
      new ApiError("Tick the box to confirm this video follows the guidelines.", 400, {
        agreed_to_guidelines: "Tick the box to confirm this video follows the guidelines.",
      }),
    );
    await open();

    await press("Choose from gallery");
    await fireEvent.changeText(screen.getByLabelText("What it shows"), "Cornrows");
    await act(async () => {
      await fireEvent.press(screen.getByRole("checkbox", { name: AGREE }));
    });
    await press("Send video");

    expect(await screen.findByText("Tick the box to confirm this video follows the guidelines.")).toBeTruthy();
    expect(mockSendPiece).not.toHaveBeenCalled();
  });

  it("deletes a gallery copy nobody will send: another chosen, or the screen left", async () => {
    mockApi.list.mockResolvedValue({ videos: [], limits: LIMITS });
    const second = "file:///data/user/0/app/cache/ImagePicker/2.mp4";
    mockPickGallery
      .mockResolvedValueOnce({ uri: GALLERY_COPY, name: "VID_1.mp4", size: 10, type: "video/mp4" })
      .mockResolvedValueOnce({ uri: second, name: "VID_2.mp4", size: 10, type: "video/mp4" });
    const view = await open();

    await press("Choose from gallery");
    await press("Video chosen · 1 KB");
    expect(mockDiscard).toHaveBeenCalledWith(GALLERY_COPY);

    await act(async () => {
      await view.unmount();
    });
    expect(mockDiscard).toHaveBeenCalledWith(second);
  });

  it("says how to carry on when the phone will not show the gallery", async () => {
    mockApi.list.mockResolvedValue({ videos: [], limits: LIMITS });
    mockPickGallery.mockResolvedValue("denied");
    await open();

    await press("Choose from gallery");

    expect(
      screen.getByText("Allow Fliiptech to see your videos in your phone's settings, or use Choose from files."),
    ).toBeTruthy();
  });

  it("carries on after the app was closed, from where the server got to, without choosing the video again", async () => {
    mockApi.list.mockResolvedValue({ videos: [video({ upload_received: 4 })], limits: LIMITS });
    mockFiles["7"] = { uri: "content://media/video%3A1", size: 10 };
    acceptingServer(4);
    await open();

    expect(await screen.findByText("Sending stopped. Everything sent so far is kept.")).toBeTruthy();
    expect(screen.getByText("1 KB of 1 KB sent (40%)")).toBeTruthy();
    await press("Carry on sending");

    await waitFor(() => expect(screen.getByText("Waiting to be prepared")).toBeTruthy());
    expect(mockPickGallery).not.toHaveBeenCalled();
    expect(mockSendPiece.mock.calls.map(([, offset]) => offset)).toEqual([4, 8]);
  });

  it("asks for the video again when the phone cleared the gallery copy", async () => {
    mockApi.list.mockResolvedValue({ videos: [video({ upload_received: 4 })], limits: LIMITS });
    mockFiles["7"] = { uri: GALLERY_COPY, size: 10 };
    mockOpen.mockImplementation(() => {
      throw new Error("The video is no longer on the phone.");
    });
    await open();

    await press("Carry on sending");

    expect(await screen.findByText("To carry on sending, choose the same video again.")).toBeTruthy();
    expect(screen.getByText("Choose “Cornrows” again")).toBeTruthy();
    expect(mockFiles).toEqual({});
    expect(mockSendPiece).not.toHaveBeenCalled();
  });

  it("asks for the same video again when the app no longer has it, and refuses a different one", async () => {
    mockApi.list.mockResolvedValue({ videos: [video({ upload_received: 4 })], limits: LIMITS });
    acceptingServer(4);
    await open();

    expect(await screen.findByText("To carry on sending, choose the same video again.")).toBeTruthy();
    const other = "file:///data/user/0/app/cache/ImagePicker/9.mp4";
    mockPickGallery.mockResolvedValueOnce({ uri: other, name: "VID_9.mp4", size: 11, type: "video/mp4" });
    await press("Choose “Cornrows” again");
    expect(
      screen.getByText("That is not the same video. Choose “Cornrows”, or remove this one and start again."),
    ).toBeTruthy();
    expect(mockDiscard).toHaveBeenCalledWith(other);
    expect(mockSendPiece).not.toHaveBeenCalled();

    // From the files this time: the card's button, below the form's.
    mockPickFiles.mockResolvedValueOnce({ uri: "content://media/video%3A1", name: "", size: 10, type: "video/mp4" });
    const fromFiles = screen.getAllByText("Choose from files");
    expect(fromFiles).toHaveLength(2);
    await act(async () => {
      await fireEvent.press(fromFiles[1]);
    });
    await waitFor(() => expect(screen.getByText("Waiting to be prepared")).toBeTruthy());
    expect(mockSendPiece.mock.calls[0][1]).toBe(4);
  });

  it("says a video was removed by our team, and why", async () => {
    mockApi.list.mockResolvedValue({
      videos: [video({ status: "rejected", upload_received: 10, review_note: "It shows another trainer's class." })],
      limits: LIMITS,
    });

    await open();

    expect(await screen.findByText("Removed by our team")).toBeTruthy();
    expect(screen.getByText("Why: It shows another trainer's class.")).toBeTruthy();
  });

  it("stops with everything kept when the connection drops, and carries on by itself when it is back", async () => {
    mockApi.list.mockResolvedValue({ videos: [video({ upload_received: 4 })], limits: LIMITS });
    mockFiles["7"] = { uri: "content://media/video%3A1", size: 10 };
    mockSendPiece.mockRejectedValue(new ApiError("No connection. Check your data or Wi-Fi and try again.", 0));
    await open();
    const carryOn = await screen.findByText("Carry on sending");

    jest.useFakeTimers();
    try {
      setOnline(false);
      await act(async () => {
        await fireEvent.press(carryOn);
        // Six retries over a minute, then it stops.
        await jest.advanceTimersByTimeAsync(62_000);
      });
      expect(screen.getByText("Sending stopped: the connection dropped. Everything sent so far is kept.")).toBeTruthy();
      expect(mockSendPiece).toHaveBeenCalledTimes(7);

      acceptingServer(4);
      await act(async () => {
        setOnline(true);
        await jest.advanceTimersByTimeAsync(100);
      });
    } finally {
      jest.useRealTimers();
    }
    await waitFor(() => expect(screen.getByText("Waiting to be prepared")).toBeTruthy());
  });
});
