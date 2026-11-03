import type { ReactNode } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  TextInput,
  View,
  type TextInputProps,
  type ViewStyle,
} from "react-native";

import { colors, fonts, radius, space } from "@/theme/tokens";

import { Text } from "./Text";

/** The one main action on a screen, or a quieter second one. */
export function Button({
  label,
  onPress,
  busy = false,
  disabled = false,
  tone = "brand",
  icon,
  style,
}: {
  label: string;
  onPress: () => void;
  busy?: boolean;
  disabled?: boolean;
  tone?: "brand" | "soft" | "outline";
  icon?: ReactNode;
  style?: ViewStyle;
}) {
  const off = disabled || busy;
  return (
    <Pressable
      onPress={onPress}
      disabled={off}
      accessibilityRole="button"
      accessibilityState={{ disabled: off, busy }}
      style={({ pressed }) => [
        styles.button,
        tone === "brand" ? styles.brand : tone === "soft" ? styles.soft : styles.outline,
        off ? styles.off : null,
        pressed ? styles.pressed : null,
        style,
      ]}
    >
      {busy ? <ActivityIndicator color={tone === "brand" ? "#fff" : colors.brand} /> : icon}
      <Text style={[styles.label, tone === "brand" ? styles.labelBrand : styles.labelSoft]}>{label}</Text>
    </Pressable>
  );
}

/** A labelled text box, with its own error under it. */
export function Field({
  label,
  hint,
  error,
  prefix,
  ...input
}: TextInputProps & { label: string; hint?: string; error?: string; prefix?: string }) {
  return (
    <View style={styles.field}>
      <Text variant="label">{label}</Text>
      <View style={[styles.box, error ? styles.boxError : null]}>
        {prefix ? <Text style={styles.prefix}>{prefix}</Text> : null}
        <TextInput
          placeholderTextColor={colors.mutedForeground}
          accessibilityLabel={label}
          {...input}
          style={[styles.input, input.multiline ? styles.multiline : null]}
        />
      </View>
      {error ? (
        <Text variant="small" style={styles.error} accessibilityLiveRegion="polite">
          {error}
        </Text>
      ) : hint ? (
        <Text variant="small">{hint}</Text>
      ) : null}
    </View>
  );
}

/** A problem the whole form has, rather than one box. */
export function FormError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <View style={styles.formError} accessibilityLiveRegion="polite">
      <Text style={styles.formErrorText}>{message}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  button: {
    minHeight: 52,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: space.sm,
    paddingHorizontal: space.xl,
    borderRadius: radius.md,
  },
  brand: { backgroundColor: colors.brand },
  soft: { backgroundColor: colors.brandSoft },
  outline: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.borderStrong },
  off: { opacity: 0.55 },
  pressed: { opacity: 0.88 },
  label: { fontFamily: fonts.bold, fontSize: 16 },
  labelBrand: { color: "#ffffff" },
  labelSoft: { color: colors.brand },
  field: { gap: 6 },
  box: {
    flexDirection: "row",
    alignItems: "center",
    minHeight: 52,
    paddingHorizontal: space.lg,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    backgroundColor: colors.card,
  },
  boxError: { borderColor: colors.destructive },
  prefix: { fontFamily: fonts.semibold, fontSize: 16, color: colors.mutedForeground, marginRight: 8 },
  input: { flex: 1, fontFamily: fonts.regular, fontSize: 16, color: colors.foreground, paddingVertical: 12 },
  multiline: { minHeight: 96, textAlignVertical: "top" },
  error: { color: colors.destructive },
  formError: { padding: space.md, borderRadius: radius.md, backgroundColor: "#fdecec" },
  formErrorText: { fontFamily: fonts.semibold, fontSize: 14, color: colors.destructive },
});
