import { router } from "expo-router";
import { ArrowLeft } from "lucide-react-native";
import type { ReactNode } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { colors, space } from "@/theme/tokens";

import { Text } from "./Text";

/** The top of a screen opened over the tabs: back, a title, maybe an action. */
export function StackHeader({ title, eyebrow, action }: { title: string; eyebrow?: string; action?: ReactNode }) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.bar, { paddingTop: insets.top + space.sm }]}>
      <Pressable
        onPress={() => (router.canGoBack() ? router.back() : router.replace("/"))}
        accessibilityRole="button"
        accessibilityLabel="Back"
        hitSlop={8}
        style={styles.back}
      >
        <ArrowLeft size={22} color={colors.foreground} />
      </Pressable>
      <View style={{ flex: 1 }}>
        {eyebrow ? <Text variant="eyebrow">{eyebrow}</Text> : null}
        <Text variant="title" numberOfLines={1}>
          {title}
        </Text>
      </View>
      {action}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.md,
    paddingHorizontal: space.lg,
    paddingBottom: space.md,
    backgroundColor: colors.background,
  },
  back: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.muted,
  },
});
