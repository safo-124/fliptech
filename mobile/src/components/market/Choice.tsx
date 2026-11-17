import { Pressable, StyleSheet, View } from "react-native";

import { Text } from "@/components/Text";
import { colors, fonts, radius, space } from "@/theme/tokens";

/** Collect or Delivery: one of two, at least 44 points tall. */
export function Way({
  active,
  onPress,
  icon,
  title,
  detail,
}: {
  active: boolean;
  onPress: () => void;
  icon: React.ReactNode;
  title: string;
  detail?: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ checked: active }}
      style={[styles.way, active ? styles.wayOn : null]}
    >
      {icon}
      <View>
        <Text variant="label">{title}</Text>
        {detail ? <Text variant="small">{detail}</Text> : null}
      </View>
    </Pressable>
  );
}

/** A label and an amount in a summary. */
export function Row({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return (
    <View style={styles.row}>
      <Text style={strong ? styles.strong : styles.rowLabel}>{label}</Text>
      <Text style={strong ? styles.strongValue : styles.rowValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  way: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: space.sm,
    minHeight: 52,
    padding: space.sm,
    borderRadius: radius.lg,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.card,
  },
  wayOn: { borderColor: colors.brand, backgroundColor: colors.brandSoft },
  row: { flexDirection: "row", justifyContent: "space-between", gap: space.md },
  rowLabel: { color: colors.mutedForeground, fontSize: 14, flexShrink: 1 },
  rowValue: { fontFamily: fonts.semibold, fontSize: 14, color: colors.foreground },
  strong: { fontFamily: fonts.bold, fontSize: 16, color: colors.foreground },
  strongValue: { fontFamily: fonts.extrabold, fontSize: 18, color: colors.brandDeep },
});
