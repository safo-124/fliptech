import { Minus, Plus } from "lucide-react-native";
import { Pressable, StyleSheet, View } from "react-native";

import { Text } from "@/components/Text";
import { colors, fonts, radius } from "@/theme/tokens";

/** − n +: at least 1 and at most `max`; each button 44 points. */
export function Stepper({
  value,
  max,
  onChange,
  disabled = false,
}: {
  value: number;
  max: number;
  onChange: (next: number) => void;
  disabled?: boolean;
}) {
  const fewer = disabled || value <= 1;
  const more = disabled || value >= max;
  return (
    <View style={styles.stepper} accessibilityLabel={`How many: ${value}`}>
      <Pressable
        onPress={() => onChange(value - 1)}
        disabled={fewer}
        style={[styles.step, fewer ? styles.off : null]}
        accessibilityRole="button"
        accessibilityLabel="One fewer"
        accessibilityState={{ disabled: fewer }}
      >
        <Minus size={18} color={colors.foreground} />
      </Pressable>
      <Text style={styles.count} testID="stepper-count">
        {String(value)}
      </Text>
      <Pressable
        onPress={() => onChange(value + 1)}
        disabled={more}
        style={[styles.step, more ? styles.off : null]}
        accessibilityRole="button"
        accessibilityLabel="One more"
        accessibilityState={{ disabled: more }}
      >
        <Plus size={18} color={colors.foreground} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  stepper: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    borderRadius: radius.pill,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
  },
  step: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  off: { opacity: 0.35 },
  count: { minWidth: 28, textAlign: "center", fontFamily: fonts.bold, fontSize: 16, color: colors.foreground },
});
