import AsyncStorage from "@react-native-async-storage/async-storage";
import * as ImagePicker from "expo-image-picker";
import { Platform } from "react-native";

import {
  discardCopiesExcept,
  forgetFile,
  forgetFilesExcept,
  isGalleryCopy,
  pickFromGallery,
  rememberFile,
  trainerVideos,
} from "./trainer-videos";

// The phone's storage, as a set of file addresses.
const mockDisk = new Set<string>();

jest.mock("expo-file-system", () => {
  class File {
    readonly uri: string;
    constructor(address: string) {
      this.uri = address;
    }
    get exists() {
      return mockDisk.has(this.uri);
    }
    get size() {
      return 10;
    }
    delete() {
      if (!mockDisk.delete(this.uri)) throw new Error("No such file.");
    }
  }
  class Directory {
    readonly uri: string;
    constructor(base: { uri: string } | string, name?: string) {
      const root = typeof base === "string" ? base : base.uri;
      this.uri = name ? `${root.replace(/\/$/, "")}/${name}/` : root;
    }
    get exists() {
      return true;
    }
    list() {
      return [...mockDisk].filter((uri) => uri.startsWith(this.uri)).map((uri) => new File(uri));
    }
  }
  return { File, Directory, FileMode: { ReadOnly: "r" }, Paths: { cache: new Directory("file:///data/user/0/app/cache/") } };
});
jest.mock("@react-native-async-storage/async-storage", () =>
  jest.requireActual("@react-native-async-storage/async-storage/jest/async-storage-mock"),
);
jest.mock("expo-image-picker", () => ({
  requestMediaLibraryPermissionsAsync: jest.fn(),
  launchImageLibraryAsync: jest.fn(),
}));
jest.mock("expo/fetch", () => ({ fetch: jest.fn() }));
jest.mock("./session", () => ({ token: () => null }));
const mockPost = jest.fn();
jest.mock("./api", () => ({
  ApiError: class ApiError extends Error {},
  getJson: jest.fn(),
  postJson: (...args: unknown[]) => mockPost(...args),
  request: jest.fn(),
}));

const CACHE = "file:///data/user/0/app/cache/ImagePicker";
const OWN_FILE = "file:///storage/emulated/0/DCIM/Camera/lesson.mp4";

beforeEach(async () => {
  mockDisk.clear();
  await AsyncStorage.clear();
  jest.clearAllMocks();
});

describe("gallery copies", () => {
  it("knows the image picker's video copies from everything else", () => {
    expect(isGalleryCopy(`${CACHE}/a1.mp4`)).toBe(true);
    expect(isGalleryCopy("content://com.android.providers.media.documents/document/video%3A12")).toBe(false);
    expect(isGalleryCopy(OWN_FILE)).toBe(false);
    // The profile photo passes through the same folder.
    expect(isGalleryCopy(`${CACHE}/photo.jpg`)).toBe(false);
    expect(isGalleryCopy("file:///data/user/0/app/cache/other/a1.mp4")).toBe(false);
  });

  it("knows an iPhone's copies too, which keep the original's .MOV", () => {
    expect(isGalleryCopy(`${CACHE}/B7C1.MOV`)).toBe(true);
    expect(isGalleryCopy(`${CACHE}/b7c1.m4v`)).toBe(true);
    expect(isGalleryCopy(`${CACHE}/IMG_0001.HEIC`)).toBe(false);
  });

  it("deletes an upload's gallery copy once the upload is forgotten, and never the trainer's own file", async () => {
    mockDisk.add(`${CACHE}/a1.mp4`).add(OWN_FILE);
    await rememberFile(1, `${CACHE}/a1.mp4`, 10);
    await rememberFile(2, OWN_FILE, 10);

    await forgetFile(1);
    await forgetFile(2);

    expect([...mockDisk]).toEqual([OWN_FILE]);
  });

  it("deletes the copies of uploads that finished elsewhere, and keeps those still arriving", async () => {
    mockDisk.add(`${CACHE}/a1.mp4`).add(`${CACHE}/a2.mp4`);
    await rememberFile(1, `${CACHE}/a1.mp4`, 10);
    await rememberFile(2, `${CACHE}/a2.mp4`, 10);

    const kept = await forgetFilesExcept([2]);

    expect(Object.keys(kept)).toEqual(["2"]);
    expect([...mockDisk]).toEqual([`${CACHE}/a2.mp4`]);
  });

  it("deletes the old copy when an upload's video is chosen again", async () => {
    mockDisk.add(`${CACHE}/a1.mp4`).add(`${CACHE}/a2.mp4`);
    await rememberFile(1, `${CACHE}/a1.mp4`, 10);

    await rememberFile(1, `${CACHE}/a2.mp4`, 10);

    expect([...mockDisk]).toEqual([`${CACHE}/a2.mp4`]);
  });

  it("tidies video copies left behind, but not pictures or the ones still needed", () => {
    mockDisk.add(`${CACHE}/left.mp4`).add(`${CACHE}/kept.mp4`).add(`${CACHE}/photo.jpg`).add(OWN_FILE);

    discardCopiesExcept([`${CACHE}/kept.mp4`]);

    expect([...mockDisk].sort()).toEqual([`${CACHE}/kept.mp4`, `${CACHE}/photo.jpg`, OWN_FILE].sort());
  });
});

describe("choosing from the gallery", () => {
  const permission = ImagePicker.requestMediaLibraryPermissionsAsync as jest.Mock;
  const library = ImagePicker.launchImageLibraryAsync as jest.Mock;

  it("says so when an Android phone will not show the gallery", async () => {
    const os = jest.replaceProperty(Platform, "OS", "android");
    permission.mockResolvedValue({ granted: false });

    expect(await pickFromGallery()).toBe("denied");
    expect(library).not.toHaveBeenCalled();
    os.restore();
  });

  it("opens an iPhone's gallery without asking for the photo library", async () => {
    const os = jest.replaceProperty(Platform, "OS", "ios");
    library.mockResolvedValue({ canceled: true, assets: null });

    expect(await pickFromGallery()).toBeNull();
    expect(permission).not.toHaveBeenCalled();
    expect(library).toHaveBeenCalled();
    os.restore();
  });

  it("asks for videos only, unedited, and hands back the copy with its name", async () => {
    permission.mockResolvedValue({ granted: true });
    mockDisk.add(`${CACHE}/a1.mp4`);
    library.mockResolvedValue({
      canceled: false,
      assets: [{ uri: `${CACHE}/a1.mp4`, fileName: "VID_20261120.mp4", fileSize: 12, mimeType: "video/mp4" }],
    });

    const picked = await pickFromGallery();

    expect(library).toHaveBeenCalledWith({ mediaTypes: ["videos"], allowsEditing: false });
    // The copy's own size, which is what is sent.
    expect(picked).toEqual({ uri: `${CACHE}/a1.mp4`, name: "VID_20261120.mp4", size: 10, type: "video/mp4" });
  });

  it("is nothing when the trainer backs out", async () => {
    permission.mockResolvedValue({ granted: true });
    library.mockResolvedValue({ canceled: true, assets: null });

    expect(await pickFromGallery()).toBeNull();
  });
});

it("sends the trainer's word that the video follows the guidelines", async () => {
  mockPost.mockResolvedValue({ id: 1 });

  await trainerVideos.start("Cornrows", { uri: `${CACHE}/a1.mp4`, name: "VID.mp4", size: 10, type: "video/mp4" }, true);

  expect(mockPost).toHaveBeenCalledWith("/api/trainer/profile/videos/", {
    title: "Cornrows",
    name: "VID.mp4",
    size: 10,
    content_type: "video/mp4",
    agreed_to_guidelines: true,
  });
});
