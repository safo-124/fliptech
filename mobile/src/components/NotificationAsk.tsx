import * as SecureStore from "expo-secure-store";
import { BatteryCharging, BellOff, BellRing } from "lucide-react-native";
import { useEffect, useState } from "react";
import { Linking, Modal, Platform, Pressable, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Button } from "@/components/Form";
import { Text } from "@/components/Text";
import { askNotificationPermission, notificationPermission } from "@/lib/notices";
import { useNotificationPermission } from "@/lib/notify-permission";
import { colors, fonts, radius, shadow, space } from "@/theme/tokens";

/*
 * Notifications without Firebase, the asking half. The app shows its own
 * notifications (lib/notices.ts); this is how the person comes to allow them:
 *
 *   - NotificationAsk: a sheet, once, right after something they will want
 *     news of (their first message, enquiry or order), or the next time they
 *     open the app after signing in. "Turn on" brings up the phone's prompt.
 *   - NotificationsBanner: on Messages, Business messages, My orders and Me,
 *     while notifications are off, with a way to turn them on.
 *   - The battery card: Android only, once notifications are on, because
 *     several phones sold in Ghana stop background apps to save battery.
 */

const ASKED = "fliiptech.notify.asked";
const BATTERY_DONE = "fliiptech.battery.done";
const native = Platform.OS !== "web";

async function flag(key: string) {
  try {
    return (await SecureStore.getItemAsync(key)) === "1";
  } catch {
    return false;
  }
}

async function setFlag(key: string) {
  try {
    await SecureStore.setItemAsync(key, "1");
  } catch {
    // Worst case they are asked once more.
  }
}

const listeners = new Set<() => void>();

/**
 * Something just happened the person will want to hear back about: show the
 * ask, if it has never been shown and notifications are not already on.
 */
export function requestNotificationAsk() {
  listeners.forEach((listener) => listener());
}

/** The sheet itself. Rendered once, by AppServices. */
export function NotificationAsk() {
  const insets = useSafeAreaInsets();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!native) return;
    const listener = () => {
      void (async () => {
        if (await flag(ASKED)) return;
        const found = await notificationPermission();
        if (found.granted || !found.canAskAgain) return;
        setOpen(true);
      })();
    };
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);

  function close() {
    setOpen(false);
    void setFlag(ASKED);
  }

  return (
    <Modal visible={open} transparent animationType="slide" onRequestClose={close}>
      <Pressable style={styles.scrim} onPress={close} accessibilityLabel="Not now" />
      <View style={[styles.sheet, { paddingBottom: insets.bottom + space.lg }]}>
        <View style={styles.icon}>
          <BellRing size={26} color={colors.brand} />
        </View>
        <Text variant="title" style={{ textAlign: "center" }}>
          Know the moment someone replies
        </Text>
        <Text style={styles.body}>
          Turn on notifications to hear about replies, enquiries and paid orders, even when Fliiptech is closed. Your
          phone will ask you to allow them.
        </Text>
        <Button
          label="Turn on"
          onPress={() => {
            close();
            void askNotificationPermission();
          }}
        />
        <Button label="Not now" tone="soft" onPress={close} />
      </View>
    </Modal>
  );
}

/**
 * "Notifications are off" while they are, on the screens where a missed
 * notification costs something. With `battery`, and once they are on, the
 * one-time Android battery card instead.
 */
export function NotificationsBanner({ battery = false }: { battery?: boolean }) {
  const permission = useNotificationPermission();
  const [batteryDone, setBatteryDone] = useState(true);

  useEffect(() => {
    if (battery && Platform.OS === "android") void flag(BATTERY_DONE).then(setBatteryDone);
  }, [battery]);

  if (!native || !permission.ready) return null;

  if (!permission.granted) {
    return (
      <View style={[styles.banner, { backgroundColor: colors.warnBg }]} accessibilityLiveRegion="polite">
        <BellOff size={18} color={colors.warn} />
        <Text style={[styles.bannerText, { color: colors.warn }]}>Notifications are off. You will miss replies.</Text>
        <Pressable onPress={() => void permission.turnOn()} accessibilityRole="button" style={styles.bannerButton}>
          <Text style={styles.bannerButtonText}>Turn on</Text>
        </Pressable>
      </View>
    );
  }

  if (battery && Platform.OS === "android" && !batteryDone) {
    const done = () => {
      setBatteryDone(true);
      void setFlag(BATTERY_DONE);
    };
    return (
      <View style={[styles.banner, styles.batteryCard]}>
        <BatteryCharging size={18} color={colors.brand} />
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={styles.batteryTitle}>So messages arrive on time</Text>
          <Text variant="small">
            Some phones stop apps in the background to save battery. In Fliiptech&apos;s settings, open Battery and
            choose Unrestricted (or No restrictions).
          </Text>
          <View style={{ flexDirection: "row", gap: space.sm, marginTop: space.xs }}>
            <Pressable
              onPress={() => {
                done();
                void Linking.openSettings();
              }}
              accessibilityRole="button"
              style={styles.bannerButton}
            >
              <Text style={styles.bannerButtonText}>Open settings</Text>
            </Pressable>
            <Pressable onPress={done} accessibilityRole="button" style={[styles.bannerButton, styles.quiet]}>
              <Text style={[styles.bannerButtonText, { color: colors.mutedForeground }]}>Done</Text>
            </Pressable>
          </View>
        </View>
      </View>
    );
  }

  return null;
}

const styles = StyleSheet.create({
  scrim: { flex: 1, backgroundColor: "rgba(23,20,38,0.45)" },
  sheet: {
    gap: space.md,
    paddingHorizontal: space.xl,
    paddingTop: space.xl,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    backgroundColor: colors.card,
    ...shadow.card,
  },
  icon: {
    alignSelf: "center",
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.brandSoft,
  },
  body: { textAlign: "center", fontSize: 15, lineHeight: 22, color: colors.mutedForeground },
  banner: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.sm,
    marginHorizontal: space.lg,
    marginVertical: space.sm,
    padding: space.md,
    borderRadius: radius.md,
  },
  bannerText: { flex: 1, fontFamily: fonts.semibold, fontSize: 13 },
  bannerButton: {
    minHeight: 34,
    justifyContent: "center",
    paddingHorizontal: space.md,
    borderRadius: radius.pill,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
  },
  bannerButtonText: { fontFamily: fonts.semibold, fontSize: 13, color: colors.brand },
  batteryCard: { alignItems: "flex-start", backgroundColor: colors.brandSoft },
  batteryTitle: { fontFamily: fonts.bold, fontSize: 14, color: colors.foreground },
  quiet: { backgroundColor: "transparent", borderColor: "transparent" },
});
