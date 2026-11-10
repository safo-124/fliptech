/**
 * Crash reports, sent to our own server (backend appsupport, read in the
 * back office), not to a third-party service. Reports the message, where
 * in the app it happened, the app version and update, and the phone model.
 * Never the person's data.
 */

import Constants from "expo-constants";
import * as Device from "expo-device";
import * as Updates from "expo-updates";
import { Platform } from "react-native";

import { postJson } from "./api";

let screen = "";
let sent = 0;

export function setScreen(path: string) {
  screen = path;
}

export async function reportCrash(error: unknown, fatal: boolean) {
  // A loop that throws on every frame must not flood the server.
  if (sent >= 5) return;
  sent += 1;
  const err = error instanceof Error ? error : new Error(String(error));
  try {
    await postJson("/api/app/crash/", {
      message: `${err.name}: ${err.message}`.slice(0, 500),
      stack: (err.stack ?? "").slice(0, 20000),
      screen,
      fatal,
      app_version: Constants.expoConfig?.version ?? "",
      update_id: Updates.updateId ?? "",
      device: [Device.manufacturer, Device.modelName].filter(Boolean).join(" "),
      os_version: `${Platform.OS} ${Device.osVersion ?? ""}`.trim(),
    });
  } catch {
    // Offline: the report is lost, the app carries on.
  }
}

type GlobalErrorUtils = {
  getGlobalHandler: () => (error: unknown, isFatal?: boolean) => void;
  setGlobalHandler: (handler: (error: unknown, isFatal?: boolean) => void) => void;
};

/** Errors nothing caught: report them, then let React Native do what it did. */
export function installCrashHandler() {
  const utils = (globalThis as { ErrorUtils?: GlobalErrorUtils }).ErrorUtils;
  if (!utils || __DEV__) return;
  const previous = utils.getGlobalHandler();
  utils.setGlobalHandler((error, isFatal) => {
    void reportCrash(error, Boolean(isFatal));
    previous(error, isFatal);
  });
}
