/**
 * The app's config: app.json, plus what depends on where the app is built
 * for (the site and API addresses, from EXPO_PUBLIC_SITE_URL and
 * EXPO_PUBLIC_API_URL in eas.json or the environment).
 *
 * - App Links: https links to the site (shared on WhatsApp, in an SMS) open
 *   the app on that page instead of the browser, once Android has checked
 *   the site's /.well-known/assetlinks.json (frontend, from the
 *   ANDROID_CERT_SHA256 setting on the server).
 * - Updates: the app asks our own server for new versions of its JavaScript
 *   (backend appsupport/updates.py), not Expo's cloud. Published with
 *   scripts/publish-update.sh.
 */

import type { ConfigContext, ExpoConfig } from "expo/config";

const SITE = (process.env.EXPO_PUBLIC_SITE_URL ?? "").replace(/\/$/, "");
const API = (process.env.EXPO_PUBLIC_API_URL ?? "").replace(/\/$/, "");

function publicHttps(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") return null;
    if (/^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(parsed.hostname)) return null;
    return parsed.hostname;
  } catch {
    return null;
  }
}

export default ({ config }: ConfigContext): ExpoConfig => {
  const linkHost = publicHttps(SITE);
  const updatesOn = Boolean(publicHttps(API));
  return {
    ...config,
    name: config.name ?? "Fliiptech",
    slug: config.slug ?? "fliiptech",
    // A new runtime version for each app version: an update is only ever
    // given to builds that can run it.
    runtimeVersion: { policy: "appVersion" },
    updates: {
      enabled: updatesOn,
      url: updatesOn ? `${API}/api/app/updates/manifest/` : undefined,
      checkAutomatically: "ON_LOAD",
      // Never hold the app on the splash screen for an update: it downloads
      // in the background and is used from the next start (or a tap on the
      // "new version is ready" note).
      fallbackToCacheTimeout: 0,
    },
    android: {
      ...config.android,
      intentFilters: linkHost
        ? [
            {
              action: "VIEW",
              autoVerify: true,
              data: [{ scheme: "https", host: linkHost }],
              category: ["BROWSABLE", "DEFAULT"],
            },
          ]
        : [],
    },
    plugins: [
      ...(config.plugins ?? []),
      ["expo-notifications", { color: "#581cb1" }],
      "expo-background-task",
    ],
  };
};
