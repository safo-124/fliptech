/**
 * Notifications without Firebase.
 *
 * The server keeps a notice for each thing it would have texted (backend
 * appsupport/notify.py). The app collects them from /api/app/notices/:
 *
 *   - when it opens or comes back to the front, and
 *   - in the background, as often as Android allows (about every 15
 *     minutes, less on a phone saving battery), with expo-background-task.
 *
 * Each new notice is shown as an ordinary phone notification, made on the
 * phone itself. Tapping it opens the screen its link points to (links.ts).
 * While the app checks in, the server stops sending the same thing by SMS.
 */

import * as BackgroundTask from "expo-background-task";
import * as Notifications from "expo-notifications";
import { AndroidImportance } from "expo-notifications";
import * as SecureStore from "expo-secure-store";
import * as TaskManager from "expo-task-manager";
import { Platform } from "react-native";

import { getJson, request } from "./api";
import { loadToken, token } from "./session";

export type Notice = {
  id: number;
  title: string;
  body: string;
  link: string;
  created_at: string;
  read: boolean;
};

const TASK = "fliiptech-notices";
const LAST_SHOWN = "fliiptech.notices.last";
const CHANNEL = "updates";
const native = Platform.OS !== "web";

// Shown even while the app is open: a new message should not be silent
// because the person happens to be looking at another screen.
if (native) {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    }),
  });
}

export const fetchNotices = () => getJson<{ results: Notice[]; unread: number }>("/api/app/notices/");

export const markRead = (ids: number[] | "all") => request<{ marked: number }>("POST", "/api/app/notices/", { body: { read: ids } });

async function lastShown(): Promise<number> {
  try {
    return Number((await SecureStore.getItemAsync(LAST_SHOWN)) ?? 0) || 0;
  } catch {
    return 0;
  }
}

async function setLastShown(id: number) {
  try {
    await SecureStore.setItemAsync(LAST_SHOWN, String(id));
  } catch {
    // Worst case a notice is shown twice.
  }
}

/**
 * Ask the server for notices newer than the last one shown, and show them.
 * Safe to call often. Returns how many were new.
 */
export async function checkNotices(): Promise<number> {
  if (!native) return 0;
  if (!token()) await loadToken();
  if (!token()) return 0;
  const after = await lastShown();
  const found = await getJson<{ results: Notice[] }>("/api/app/notices/", {
    after: after ? String(after) : undefined,
  });
  // The first check after signing in shows nothing old: it only marks where
  // "new" starts, so a phone does not light up with last month's news.
  const fresh = found.results.filter((notice) => !notice.read);
  if (after) {
    for (const notice of [...fresh].reverse()) {
      await Notifications.scheduleNotificationAsync({
        content: { title: notice.title, body: notice.body, data: { link: notice.link, id: notice.id } },
        trigger: Platform.OS === "android" ? { channelId: CHANNEL } : null,
      });
    }
  }
  const newest = Math.max(after, ...found.results.map((notice) => notice.id));
  if (newest > after) await setLastShown(newest);
  return after ? fresh.length : 0;
}

// Defined at load, as TaskManager requires: Android may start the app's
// JavaScript in the background just to run this.
if (native) {
  TaskManager.defineTask(TASK, async () => {
    try {
      await checkNotices();
      return BackgroundTask.BackgroundTaskResult.Success;
    } catch {
      return BackgroundTask.BackgroundTaskResult.Failed;
    }
  });
}

function makeChannel() {
  return Notifications.setNotificationChannelAsync(CHANNEL, {
    name: "Orders, messages and alerts",
    importance: AndroidImportance.HIGH,
    lightColor: "#581cb1",
  });
}

/** Whether notifications are on, and whether the phone still lets the app ask. */
export async function notificationPermission(): Promise<{ granted: boolean; canAskAgain: boolean }> {
  if (!native) return { granted: true, canAskAgain: false };
  try {
    const current = await Notifications.getPermissionsAsync();
    return { granted: current.granted, canAskAgain: current.canAskAgain };
  } catch {
    return { granted: false, canAskAgain: false };
  }
}

/**
 * The phone's own "Allow notifications?" prompt. Called from the app's ask
 * (components/NotificationAsk.tsx) after the person said yes to it, never
 * on its own: a cold system prompt at sign-in is the one most people refuse.
 * The channel comes first, as Android 13 shows no prompt without one.
 */
export async function askNotificationPermission(): Promise<boolean> {
  if (!native) return true;
  try {
    await makeChannel();
    const answer = await Notifications.requestPermissionsAsync();
    return answer.granted;
  } catch {
    return false;
  }
}

/** Once signed in: the channel and the background check. Asking for the
    permission is NotificationAsk's job. Calling twice is harmless. */
export async function startNotices() {
  if (!native) return;
  try {
    await makeChannel();
    const status = await BackgroundTask.getStatusAsync();
    if (status === BackgroundTask.BackgroundTaskStatus.Available) {
      const registered = await TaskManager.isTaskRegisteredAsync(TASK);
      if (!registered) await BackgroundTask.registerTaskAsync(TASK, { minimumInterval: 15 });
    }
  } catch {
    // Notices still arrive whenever the app is opened.
  }
}

/** On sign-out: stop checking, and forget where "new" started. */
export async function stopNotices() {
  if (!native) return;
  try {
    if (await TaskManager.isTaskRegisteredAsync(TASK)) await BackgroundTask.unregisterTaskAsync(TASK);
    await SecureStore.deleteItemAsync(LAST_SHOWN);
  } catch {
    // Nothing to stop.
  }
}
