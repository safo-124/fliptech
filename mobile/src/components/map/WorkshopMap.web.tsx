import { MapPinned } from "lucide-react-native";
import { StyleSheet, View } from "react-native";

import { Text } from "@/components/Text";
import { colors, space } from "@/theme/tokens";

import type { WorkshopMapProps } from "./types";

/**
 * The web build (a development preview only: the app ships for Android).
 * MapLibre's React Native map has no web version, so this says so, and the
 * screen's buttons, chips and card still work around it.
 */
export function WorkshopMap({ workshops }: WorkshopMapProps) {
  return (
    <View style={[StyleSheet.absoluteFill, styles.box]}>
      <MapPinned size={40} color={colors.brandViolet} />
      <Text variant="heading" style={styles.center}>
        The map shows on Android
      </Text>
      <Text variant="small" style={styles.center}>
        {workshops.length} workshops would be pinned here.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  box: { alignItems: "center", justifyContent: "center", gap: space.sm, backgroundColor: "#e8e4dc" },
  center: { textAlign: "center" },
});
