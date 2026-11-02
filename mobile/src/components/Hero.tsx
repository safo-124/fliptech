import { LinearGradient } from "expo-linear-gradient";
import { Pressable, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { colors, fonts, radius, space } from "@/theme/tokens";

import { MapButton } from "./MapButton";
import { Text } from "./Text";

/**
 * The big indigo card at the top of Home: one message and one action, in
 * the website's band colours with the warm glow at its corner.
 */
export function Hero({
  eyebrow,
  title,
  body,
  action,
  onAction,
  onMap,
}: {
  eyebrow: string;
  title: string;
  body: string;
  action: string;
  onAction: () => void;
  /** Shows the map button in the card's top-right corner. */
  onMap?: () => void;
}) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.wrap, { paddingTop: insets.top + space.sm }]}>
      <LinearGradient
        colors={[colors.brandGlow, colors.brandDeep, "#1a0040"]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.card}
      >
        <View style={[styles.glow, styles.glowPink]} />
        <View style={[styles.glow, styles.glowSand]} />
        {onMap ? (
          <View style={styles.corner}>
            <MapButton tone="onDark" onPress={onMap} />
          </View>
        ) : null}
        <Text variant="eyebrow" style={styles.eyebrow}>
          {eyebrow}
        </Text>
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.body}>{body}</Text>
        <Pressable
          onPress={onAction}
          accessibilityRole="button"
          style={({ pressed }) => [styles.button, pressed ? { opacity: 0.9 } : null]}
        >
          <Text style={styles.buttonText}>{action}</Text>
        </Pressable>
      </LinearGradient>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: space.lg },
  card: {
    borderRadius: radius.xl,
    padding: space.xl,
    paddingTop: 72,
    overflow: "hidden",
  },
  glow: { position: "absolute", borderRadius: 999 },
  glowPink: { width: 220, height: 220, right: -70, top: -80, backgroundColor: colors.brandPink, opacity: 0.28 },
  glowSand: { width: 160, height: 160, left: -60, bottom: -70, backgroundColor: colors.peach, opacity: 0.2 },
  corner: { position: "absolute", top: space.lg, right: space.lg },
  eyebrow: { color: colors.peach },
  title: {
    marginTop: space.sm,
    fontFamily: fonts.extrabold,
    fontSize: 34,
    lineHeight: 38,
    letterSpacing: -1,
    color: "#ffffff",
  },
  body: {
    marginTop: space.md,
    fontFamily: fonts.regular,
    fontSize: 15,
    lineHeight: 22,
    color: "rgba(255,255,255,0.8)",
  },
  button: {
    marginTop: space.xl,
    minHeight: 50,
    borderRadius: radius.md,
    backgroundColor: colors.brand,
    alignItems: "center",
    justifyContent: "center",
  },
  buttonText: { fontFamily: fonts.bold, fontSize: 16, color: "#ffffff" },
});
