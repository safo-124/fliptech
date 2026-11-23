import { Directory, File, Paths } from "expo-file-system";
import { Platform } from "react-native";

import { token } from "./session";
import type { VideoSource } from "./types";

/**
 * Lessons saved to the phone, to watch with no data. The smallest copy is
 * saved (360p, a few MB a minute), into the app's own folder: deleted with
 * the app, and not visible to other apps.
 *
 * On an iPhone the folder is the app's Caches, not Documents: Apple backs up
 * Documents to iCloud and rejects apps that put videos there which can be
 * downloaded again. An iPhone very short of space may clear Caches; a lesson
 * cleared that way shows as not saved, and can be saved again.
 */
const folder = () => new Directory(Platform.OS === "ios" ? Paths.cache : Paths.document, "lessons");
const fileFor = (lesson: number) => new File(folder(), `${lesson}.mp4`);

export function savedLesson(lesson: number): string | null {
  try {
    const file = fileFor(lesson);
    return file.exists ? file.uri : null;
  } catch {
    return null;
  }
}

export function smallest(sources: VideoSource[]): VideoSource | null {
  return [...sources].sort((a, b) => a.quality - b.quality)[0] ?? null;
}

export async function saveLesson(lesson: number, sources: VideoSource[], onProgress?: (share: number) => void) {
  const source = smallest(sources);
  if (!source) throw new Error("This lesson cannot be saved.");
  const dir = folder();
  dir.create({ idempotent: true, intermediates: true });
  const signedIn = token();
  const file = await File.downloadFileAsync(source.url, fileFor(lesson), {
    idempotent: true,
    headers: signedIn ? { Authorization: `Bearer ${signedIn}` } : {},
    onProgress: ({ bytesWritten, totalBytes }) => {
      if (onProgress && totalBytes > 0) onProgress(bytesWritten / totalBytes);
    },
  });
  return file.uri;
}

export function forgetLesson(lesson: number) {
  try {
    const file = fileFor(lesson);
    if (file.exists) file.delete();
  } catch {
    // Already gone.
  }
}
