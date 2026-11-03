import { X } from "lucide-react-native";
import { useState } from "react";
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Switch, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Button, Field } from "@/components/Form";
import { Text } from "@/components/Text";
import { SORTS, SWITCHES, type MarketFilters } from "@/lib/market";
import { colors, fonts, radius, space } from "@/theme/tokens";

const SOLD_BY: { value: MarketFilters["sold_by"]; label: string }[] = [
  { value: undefined, label: "Anyone" },
  { value: "trainers", label: "Training workshops" },
  { value: "makers", label: "Independent makers" },
];

const CONDITIONS: { value: MarketFilters["condition"]; label: string }[] = [
  { value: undefined, label: "New or used" },
  { value: "new", label: "New only" },
  { value: "used", label: "Second-hand" },
];

/**
 * Every marketplace filter on one sheet: who sells it, price, sort, and the
 * switches. Changes apply when "Show results" is tapped, so the list does
 * not reload (and spend data) on every tap.
 */
export function FilterSheet({
  visible,
  filters,
  onApply,
  onClose,
}: {
  visible: boolean;
  filters: MarketFilters;
  onApply: (filters: MarketFilters) => void;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  const [draft, setDraft] = useState(filters);
  const set = (change: Partial<MarketFilters>) => setDraft((now) => ({ ...now, ...change }));

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={onClose}
      onShow={() => setDraft(filters)}
      statusBarTranslucent
    >
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Close filters" />
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.sheetWrap}>
        <View style={[styles.sheet, { paddingBottom: insets.bottom + space.md }]}>
          <View style={styles.handle} />
          <View style={styles.top}>
            <Text variant="title">Filters</Text>
            <Pressable onPress={onClose} hitSlop={10} accessibilityRole="button" accessibilityLabel="Close">
              <X size={22} color={colors.foreground} />
            </Pressable>
          </View>
          <ScrollView contentContainerStyle={{ gap: space.xl, paddingBottom: space.lg }} keyboardShouldPersistTaps="handled">
            <View style={{ gap: space.sm }}>
              <Text variant="label">Sold by</Text>
              <View style={styles.chips}>
                {SOLD_BY.map((option) => (
                  <Chip
                    key={option.label}
                    label={option.label}
                    on={draft.sold_by === option.value}
                    onPress={() => set({ sold_by: option.value })}
                  />
                ))}
              </View>
            </View>

            <View style={{ gap: space.sm }}>
              <Text variant="label">Condition</Text>
              <View style={styles.chips}>
                {CONDITIONS.map((option) => (
                  <Chip
                    key={option.label}
                    label={option.label}
                    on={draft.condition === option.value}
                    onPress={() => set({ condition: option.value })}
                  />
                ))}
              </View>
            </View>

            <View style={{ gap: space.sm }}>
              <Text variant="label">Price (GH₵)</Text>
              <View style={{ flexDirection: "row", gap: space.md }}>
                <View style={{ flex: 1 }}>
                  <Field
                    label="Lowest"
                    value={draft.min_price ?? ""}
                    onChangeText={(text) => set({ min_price: text })}
                    keyboardType="numeric"
                    placeholder="0"
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Field
                    label="Highest"
                    value={draft.max_price ?? ""}
                    onChangeText={(text) => set({ max_price: text })}
                    keyboardType="numeric"
                    placeholder="Any"
                  />
                </View>
              </View>
            </View>

            <View style={{ gap: space.sm }}>
              <Text variant="label">Sort</Text>
              <View style={styles.chips}>
                {SORTS.map((option) => (
                  <Chip
                    key={option.value || "best"}
                    label={option.label}
                    on={(draft.sort ?? "") === option.value}
                    onPress={() => set({ sort: option.value })}
                  />
                ))}
              </View>
            </View>

            <View>
              <Text variant="label">Show only</Text>
              {SWITCHES.map(([key, label]) => (
                <View key={key} style={styles.switchRow}>
                  <Text style={{ flex: 1 }}>{label === "Pay online" ? "Pay on Fliiptech (MoMo or card)" : label}</Text>
                  <Switch
                    value={Boolean(draft[key])}
                    onValueChange={(on) => set({ [key]: on })}
                    trackColor={{ true: colors.brand, false: colors.borderStrong }}
                    thumbColor="#ffffff"
                    accessibilityLabel={label}
                  />
                </View>
              ))}
            </View>
          </ScrollView>
          <View style={styles.actions}>
            <Button
              label="Clear all"
              tone="soft"
              onPress={() => setDraft({ q: filters.q, trade: filters.trade })}
              style={{ flex: 1 }}
            />
            <Button
              label="Show results"
              onPress={() => {
                onApply(draft);
                onClose();
              }}
              style={{ flex: 2 }}
            />
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

export function Chip({
  label,
  on,
  onPress,
  icon,
}: {
  label: string;
  on: boolean;
  onPress: () => void;
  icon?: React.ReactNode;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: on }}
      style={[styles.chip, on ? styles.chipOn : null]}
    >
      {icon}
      <Text style={[styles.chipText, on ? { color: "#ffffff" } : null]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  backdrop: { ...StyleSheet.absoluteFill, backgroundColor: "rgba(23,20,38,0.45)" },
  sheetWrap: { flex: 1, justifyContent: "flex-end" },
  sheet: {
    maxHeight: "88%",
    paddingHorizontal: space.lg,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    backgroundColor: colors.background,
  },
  handle: {
    alignSelf: "center",
    width: 40,
    height: 4,
    borderRadius: 2,
    marginTop: space.sm,
    backgroundColor: colors.borderStrong,
  },
  top: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: space.md },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: space.sm },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    minHeight: 40,
    paddingHorizontal: space.md,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    backgroundColor: colors.card,
  },
  chipOn: { backgroundColor: colors.brand, borderColor: colors.brand },
  chipText: { fontFamily: fonts.semibold, fontSize: 13, color: colors.foreground },
  switchRow: {
    flexDirection: "row",
    alignItems: "center",
    minHeight: 52,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  actions: { flexDirection: "row", gap: space.md, paddingTop: space.md },
});
