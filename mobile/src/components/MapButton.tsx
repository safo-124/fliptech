import { List, MapPinned } from "lucide-react-native";
import { Pressable, StyleSheet } from "react-native";

import { colors, shadow } from "@/theme/tokens";

/**
 * The round button in a screen's top-right corner that opens the map, or,
 * on the map, goes back to the list.
 */
export function MapButton({
  onPress,
  mode = "map",
  tone = "light",
}: {
  onPress: () => void;
  mode?: "map" | "list";
  /** "onDark" for the purple hero card. */
  tone?: "light" | "onDark";
}) {
  const Icon = mode === "map" ? MapPinned : List;
  const dark = tone === "onDark";
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={mode === "map" ? "Show workshops on a map" : "Show the list"}
      hitSlop={6}
      style={({ pressed }) => [
        styles.button,
        dark ? styles.onDark : styles.light,
        pressed ? { transform: [{ scale: 0.94 }] } : null,
      ]}
    >
      <Icon size={22} color={dark ? "#ffffff" : colors.brand} strokeWidth={2.2} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: { width: 48, height: 48, borderRadius: 24, alignItems: "center", justifyContent: "center" },
  light: { backgroundColor: colors.card, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, ...shadow.card },
  onDark: { backgroundColor: "rgba(255,255,255,0.16)", borderWidth: 1, borderColor: "rgba(255,255,255,0.3)" },
});
