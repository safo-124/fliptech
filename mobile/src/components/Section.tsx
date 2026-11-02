import { ChevronRight } from "lucide-react-native";
import type { ReactNode } from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";

import { colors, fonts, space } from "@/theme/tokens";

import { Text } from "./Text";

/** A titled row of cards that scrolls sideways, like the shop windows on Home. */
export function Section({
  title,
  accent,
  action,
  onAction,
  children,
}: {
  title: string;
  /** Words of the title in brand purple: "Top courses in *Welding*". */
  accent?: string;
  action?: string;
  onAction?: () => void;
  children: ReactNode;
}) {
  return (
    <View style={styles.section}>
      <View style={styles.head}>
        <Text variant="title" style={styles.title}>
          {title}
          {accent ? <Text variant="title" style={styles.accent}>{` ${accent}`}</Text> : null}
        </Text>
        {action && onAction ? (
          <Pressable onPress={onAction} hitSlop={8} style={styles.action} accessibilityRole="link">
            <Text style={styles.actionText}>{action}</Text>
            <ChevronRight size={16} color={colors.brand} />
          </Pressable>
        ) : null}
      </View>
      {children}
    </View>
  );
}

/** The sideways-scrolling strip a Section's cards sit in. */
export function Shelf({ children }: { children: ReactNode }) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.shelf}
      decelerationRate="fast"
    >
      {children}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  section: { marginTop: space.xxl },
  head: {
    flexDirection: "row",
    alignItems: "flex-end",
    justifyContent: "space-between",
    gap: space.md,
    paddingHorizontal: space.lg,
    marginBottom: space.md,
  },
  title: { flex: 1 },
  accent: { color: colors.brand },
  action: { flexDirection: "row", alignItems: "center", gap: 2, paddingBottom: 2 },
  actionText: { fontFamily: fonts.bold, fontSize: 14, color: colors.brand },
  shelf: { paddingHorizontal: space.lg, gap: space.md },
});
