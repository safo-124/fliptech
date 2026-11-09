import Constants from "expo-constants";
import * as Notifications from "expo-notifications";
import * as Updates from "expo-updates";
import { Check } from "lucide-react-native";
import { useState } from "react";
import { Linking, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { StackHeader } from "@/components/StackHeader";
import { Text } from "@/components/Text";
import { useDataSaver, type SaverMode } from "@/lib/datasaver";
import { colors, fonts, radius, space } from "@/theme/tokens";

const MODES: { value: SaverMode; label: string; body: string }[] = [
  { value: "auto", label: "Automatic", body: "On when you use mobile data, off on Wi-Fi." },
  { value: "on", label: "Always on", body: "Smaller photos everywhere, lessons at the smallest size, nothing plays by itself." },
  { value: "off", label: "Off", body: "Full-size photos and the best lesson quality." },
];

/** Ask for permission once; after that, the phone's own settings page. */
async function openNotificationSettings() {
  const current = await Notifications.getPermissionsAsync();
  if (current.granted || !current.canAskAgain) await Linking.openSettings();
  else await Notifications.requestPermissionsAsync();
}

/** Data saver, notifications, and which version of the app this is. */
export default function SettingsScreen() {
  const insets = useSafeAreaInsets();
  const saver = useDataSaver();
  const updates = Updates.useUpdates();
  const [checking, setChecking] = useState<"idle" | "checking" | "latest" | "failed">("idle");

  async function checkForUpdate() {
    setChecking("checking");
    try {
      const found = await Updates.checkForUpdateAsync();
      if (found.isAvailable) await Updates.fetchUpdateAsync();
      setChecking(found.isAvailable ? "idle" : "latest");
    } catch {
      setChecking("failed");
    }
  }

  return (
    <View style={styles.screen}>
      <StackHeader eyebrow="APP" title="Settings" />
      <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.xl, paddingBottom: insets.bottom + space.xl }}>
        <View style={{ gap: space.sm }}>
          <Text variant="heading">Data saver</Text>
          <Text variant="small">
            {saver.saving ? "Saving data now." : "Not saving data now."} Photos come resized from Fliiptech either way.
          </Text>
          {MODES.map((mode) => {
            const on = saver.mode === mode.value;
            return (
              <Pressable
                key={mode.value}
                onPress={() => saver.setMode(mode.value)}
                style={[styles.option, on ? styles.optionOn : null]}
                accessibilityRole="radio"
                accessibilityState={{ checked: on }}
              >
                <View style={{ flex: 1 }}>
                  <Text style={styles.optionLabel}>{mode.label}</Text>
                  <Text variant="small">{mode.body}</Text>
                </View>
                {on ? <Check size={20} color={colors.brand} /> : null}
              </Pressable>
            );
          })}
        </View>

        <View style={{ gap: space.sm }}>
          <Text variant="heading">Notifications</Text>
          <Text variant="small">
            Orders, messages and alerts arrive as notifications while you are signed in. Fliiptech checks for them when
            you open the app and every 15 minutes or so in the background, so one can take a few minutes to arrive.
          </Text>
          <Pressable
            onPress={() => void openNotificationSettings()}
            style={styles.option}
            accessibilityRole="button"
          >
            <Text style={styles.optionLabel}>Notification settings</Text>
          </Pressable>
        </View>

        <View style={{ gap: space.sm }}>
          <Text variant="heading">About this app</Text>
          <Text variant="small">
            Version {Constants.expoConfig?.version ?? "?"}
            {Updates.updateId ? ` · update ${Updates.updateId.slice(0, 8)}` : ""}
          </Text>
          {Updates.isEnabled ? (
            <Pressable
              onPress={() => (updates.isUpdatePending ? void Updates.reloadAsync() : void checkForUpdate())}
              disabled={checking === "checking"}
              style={styles.option}
              accessibilityRole="button"
            >
              <Text style={styles.optionLabel}>
                {updates.isUpdatePending
                  ? "Restart to use the new version"
                  : checking === "checking"
                    ? "Checking…"
                    : checking === "latest"
                      ? "You have the latest version"
                      : checking === "failed"
                        ? "Could not check. Try again"
                        : "Check for an update"}
              </Text>
            </Pressable>
          ) : null}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  option: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.md,
    minHeight: 56,
    padding: space.md,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
  },
  optionOn: { borderColor: colors.brand, backgroundColor: colors.brandSoft },
  optionLabel: { fontFamily: fonts.semibold, fontSize: 15, color: colors.foreground },
});
