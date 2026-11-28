import { LinearGradient } from "expo-linear-gradient";
import type { ReactNode } from "react";
import { StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { colors, fonts, space } from "@/theme/tokens";

import { MapButton } from "./MapButton";
import { Text } from "./Text";

/**
 * The top of Home, as on the website: a short line, the headline in the deep
 * indigo of the logo, one sentence, on the page's own background with a faint
 * lavender wash. Calm on purpose: the listings below carry the colour.
 */
export function Hero({
  eyebrow,
  title,
  body,
  onMap,
  action,
}: {
  eyebrow: string;
  title: string;
  body: string;
  /** Shows the map button in the top-right corner. */
  onMap?: () => void;
  /** Another round button beside the map's, such as Messages. */
  action?: ReactNode;
}) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.wrap, { paddingTop: insets.top + space.lg }]}>
      <LinearGradient colors={[colors.brandSoft, colors.background]} style={styles.wash} pointerEvents="none" />
      <View style={styles.top}>
        <Text style={styles.eyebrow}>{eyebrow}</Text>
        <View style={styles.actions}>
          {action}
          {onMap ? <MapButton onPress={onMap} /> : null}
        </View>
      </View>
      <Text style={styles.title} accessibilityRole="header">
        {title}
      </Text>
      <Text style={styles.body}>{body}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: space.lg, paddingBottom: space.sm },
  wash: { position: "absolute", left: 0, right: 0, top: 0, height: 280 },
  top: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", minHeight: 44 },
  actions: { flexDirection: "row", alignItems: "center", gap: space.sm },
  eyebrow: { fontFamily: fonts.medium, fontSize: 13, color: colors.mutedForeground },
  title: {
    marginTop: space.md,
    fontFamily: fonts.bold,
    fontSize: 32,
    lineHeight: 37,
    letterSpacing: -0.9,
    color: colors.brandDeep,
  },
  body: { marginTop: space.md, fontFamily: fonts.regular, fontSize: 15, lineHeight: 22, color: colors.mutedForeground },
});
