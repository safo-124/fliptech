import { onlineManager, useQueryClient } from "@tanstack/react-query";
import * as Network from "expo-network";
import * as Notifications from "expo-notifications";
import { router, usePathname } from "expo-router";
import * as Updates from "expo-updates";
import { CloudOff, RefreshCw } from "lucide-react-native";
import { useEffect, useRef } from "react";
import { AppState, Platform, Pressable, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useAuth } from "@/lib/auth";
import { installCrashHandler, setScreen } from "@/lib/crash";
import { appPath } from "@/lib/links";
import { checkNotices, markRead, startNotices, stopNotices } from "@/lib/notices";
import { colors, fonts, radius, space } from "@/theme/tokens";

import { NotificationAsk, requestNotificationAsk } from "./NotificationAsk";
import { Text } from "./Text";

installCrashHandler();

// Queries wait for the connection instead of failing when the phone is
// offline, and the saved answers stay on screen meanwhile.
onlineManager.setEventListener((setOnline) => {
  const subscription = Network.addNetworkStateListener((state) => {
    setOnline(state.isConnected !== false && state.isInternetReachable !== false);
  });
  return () => subscription.remove();
});

function openNotice(response: Notifications.NotificationResponse | null) {
  const data = response?.notification.request.content.data as { link?: string; id?: number } | undefined;
  if (!data) return;
  if (data.id) void markRead([data.id]).catch(() => undefined);
  router.push(appPath(data.link || "/notices") as never);
}

/**
 * The app-wide services that have no screen of their own: collecting
 * notices, opening a tapped notification, the offline and "new version"
 * notes, and crash reports (with the screen they happened on).
 */
export function AppServices() {
  const auth = useAuth();
  const client = useQueryClient();
  const pathname = usePathname();
  const insets = useSafeAreaInsets();
  const network = Network.useNetworkState();
  const updates = Updates.useUpdates();
  const handledCold = useRef(false);

  useEffect(() => setScreen(pathname), [pathname]);

  // Notices: start when signed in, check now and each time the app returns.
  useEffect(() => {
    if (Platform.OS === "web") return;
    if (!auth.signedIn) {
      void stopNotices();
      return;
    }
    void startNotices();
    const check = () =>
      void checkNotices()
        .then((count) => {
          if (count) void client.invalidateQueries({ queryKey: ["notices"] });
        })
        .catch(() => undefined);
    check();
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") {
        check();
        // Back in the app after signing in: a fair moment for the one-time
        // ask, if a message or an enquiry has not brought it up already.
        requestNotificationAsk();
      }
    });
    return () => subscription.remove();
  }, [auth.signedIn, client]);

  // A tapped notification, whether the app was open or started by the tap.
  useEffect(() => {
    if (Platform.OS === "web") return;
    if (!handledCold.current) {
      handledCold.current = true;
      void Notifications.getLastNotificationResponseAsync().then(openNotice).catch(() => undefined);
    }
    const subscription = Notifications.addNotificationResponseReceivedListener(openNotice);
    return () => subscription.remove();
  }, []);

  const offline = network.isConnected === false || network.isInternetReachable === false;

  return (
    <View pointerEvents="box-none" style={[styles.wrap, { top: insets.top + 4 }]}>
      <NotificationAsk />
      {offline ? (
        <View style={styles.note} accessibilityLiveRegion="polite">
          <CloudOff size={16} color="#fff" />
          <Text style={styles.noteText}>Offline. Showing what you saw last.</Text>
        </View>
      ) : null}
      {Updates.isEnabled && updates.isUpdatePending ? (
        <Pressable
          onPress={() => void Updates.reloadAsync()}
          style={[styles.note, styles.update]}
          accessibilityRole="button"
        >
          <RefreshCw size={16} color="#fff" />
          <Text style={styles.noteText}>A new version is ready. Tap to restart.</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: "absolute", left: space.lg, right: space.lg, alignItems: "center", gap: 6, zIndex: 50 },
  note: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.sm,
    paddingHorizontal: space.lg,
    paddingVertical: 8,
    borderRadius: radius.pill,
    backgroundColor: "rgba(23,20,38,0.88)",
  },
  update: { backgroundColor: colors.brand },
  noteText: { fontFamily: fonts.semibold, fontSize: 13, color: "#fff" },
});
