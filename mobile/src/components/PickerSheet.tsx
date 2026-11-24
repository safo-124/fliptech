import { Check, ChevronDown, Search } from "lucide-react-native";
import { useMemo, useState } from "react";
import { FlatList, Modal, Pressable, StyleSheet, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { colors, fonts, radius, space } from "@/theme/tokens";

import { Text } from "./Text";

/**
 * A choice from a list, as a sheet from the bottom of the screen: the same
 * searchable, grouped list as the website's dropdowns (frontend
 * components/ui/picker.tsx). Towns sit under their regions; a long list gets
 * a search box.
 */
export type PickerOption = {
  value: string;
  label: string;
  /** A heading the option sits under, e.g. its region. */
  group?: string;
  /** A short note on the right, e.g. "4 workshops". */
  hint?: string;
};

/** Search appears when a list is longer than this. */
const SEARCH_FROM = 8;

type Row = { kind: "group"; key: string; label: string } | { kind: "option"; key: string; option: PickerOption };

/** The options as rows, with a heading row wherever the group changes. */
export function pickerRows(options: PickerOption[], query: string): Row[] {
  const term = query.trim().toLowerCase();
  const shown = term
    ? options.filter(
        (option) => option.label.toLowerCase().includes(term) || (option.group ?? "").toLowerCase().includes(term),
      )
    : options;
  const rows: Row[] = [];
  shown.forEach((option, index) => {
    if (option.group && option.group !== shown[index - 1]?.group) {
      rows.push({ kind: "group", key: `g-${option.group}`, label: option.group });
    }
    rows.push({ kind: "option", key: `o-${option.value || "_any"}`, option });
  });
  return rows;
}

export function PickerSheet({
  visible,
  title,
  options,
  value,
  onPick,
  onClose,
  searchPlaceholder = "Search",
  emptyLabel = "Nothing matches. Try another spelling.",
}: {
  visible: boolean;
  title: string;
  options: PickerOption[];
  value: string;
  onPick: (value: string) => void;
  onClose: () => void;
  searchPlaceholder?: string;
  emptyLabel?: string;
}) {
  const insets = useSafeAreaInsets();
  const [query, setQuery] = useState("");
  const rows = useMemo(() => pickerRows(options, query), [options, query]);
  const searchable = options.length > SEARCH_FROM;

  const close = () => {
    setQuery("");
    onClose();
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={close}>
      <Pressable style={styles.scrim} onPress={close} accessibilityLabel="Close" />
      <View style={[styles.sheet, { paddingBottom: insets.bottom + space.md }]}>
        <View style={styles.grab} />
        <Text variant="heading" style={styles.title}>
          {title}
        </Text>
        {searchable ? (
          <View style={styles.search}>
            <Search size={18} color={colors.mutedForeground} />
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder={searchPlaceholder}
              placeholderTextColor={colors.mutedForeground}
              autoCorrect={false}
              style={styles.searchInput}
              accessibilityLabel={searchPlaceholder}
            />
          </View>
        ) : null}
        <FlatList
          data={rows}
          keyExtractor={(row) => row.key}
          keyboardShouldPersistTaps="handled"
          style={styles.list}
          ListEmptyComponent={<Text variant="small" style={styles.empty}>{emptyLabel}</Text>}
          renderItem={({ item }) =>
            item.kind === "group" ? (
              <Text style={styles.group}>{item.label.toUpperCase()}</Text>
            ) : (
              <Pressable
                onPress={() => {
                  onPick(item.option.value);
                  close();
                }}
                accessibilityRole="radio"
                accessibilityState={{ selected: item.option.value === value }}
                style={({ pressed }) => [
                  styles.option,
                  item.option.value === value ? styles.optionOn : null,
                  pressed ? { opacity: 0.7 } : null,
                ]}
              >
                <Check size={18} color={item.option.value === value ? colors.brand : "transparent"} />
                <Text style={[styles.optionText, item.option.value === value ? styles.optionTextOn : null]}>
                  {item.option.label}
                </Text>
                {item.option.hint ? <Text variant="small">{item.option.hint}</Text> : null}
              </Pressable>
            )
          }
        />
      </View>
    </Modal>
  );
}

/**
 * A chip that shows what is chosen and opens the sheet: "Where: Kumasi ▾".
 */
export function SelectChip({
  label,
  options,
  value,
  onPick,
  title,
  searchPlaceholder,
  icon,
}: {
  /** Shown before the choice, e.g. "Sort". */
  label?: string;
  options: PickerOption[];
  value: string;
  onPick: (value: string) => void;
  /** The sheet's heading. */
  title: string;
  searchPlaceholder?: string;
  icon?: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const chosen = options.find((option) => option.value === value) ?? options[0];
  const active = Boolean(value);
  return (
    <>
      <Pressable
        onPress={() => setOpen(true)}
        accessibilityRole="button"
        accessibilityLabel={`${title}: ${chosen?.label ?? ""}`}
        style={({ pressed }) => [styles.chip, active ? styles.chipOn : null, pressed ? { opacity: 0.85 } : null]}
      >
        {icon}
        <Text style={[styles.chipText, active ? styles.chipTextOn : null]} numberOfLines={1}>
          {label ? `${label}: ` : ""}
          {chosen?.label}
        </Text>
        <ChevronDown size={16} color={active ? colors.brand : colors.mutedForeground} />
      </Pressable>
      <PickerSheet
        visible={open}
        title={title}
        options={options}
        value={value}
        onPick={onPick}
        onClose={() => setOpen(false)}
        searchPlaceholder={searchPlaceholder}
      />
    </>
  );
}

/** Areas as options under their regions, regions and areas in order. */
export function areaOptions(
  regions: { name: string; areas: { slug: string; name: string; provider_count: number }[] }[],
  { onlyWithWorkshops = false }: { onlyWithWorkshops?: boolean } = {},
): PickerOption[] {
  return [...regions]
    .sort((a, b) => a.name.localeCompare(b.name))
    .flatMap((region) =>
      region.areas
        .filter((area) => !onlyWithWorkshops || area.provider_count > 0)
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((area) => ({
          value: area.slug,
          label: area.name,
          group: region.name,
          hint: area.provider_count
            ? `${area.provider_count} ${area.provider_count === 1 ? "workshop" : "workshops"}`
            : undefined,
        })),
    );
}

const styles = StyleSheet.create({
  scrim: { flex: 1, backgroundColor: "rgba(38,0,90,0.35)" },
  sheet: {
    maxHeight: "78%",
    backgroundColor: colors.card,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    paddingHorizontal: space.md,
    paddingTop: space.sm,
  },
  grab: { alignSelf: "center", width: 40, height: 5, borderRadius: 3, backgroundColor: colors.borderStrong, marginBottom: space.md },
  title: { paddingHorizontal: space.sm, marginBottom: space.sm },
  search: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.sm,
    marginHorizontal: space.xs,
    marginBottom: space.sm,
    paddingHorizontal: space.md,
    minHeight: 46,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.muted,
  },
  searchInput: { flex: 1, fontFamily: fonts.regular, fontSize: 16, color: colors.foreground, paddingVertical: 0 },
  list: { flexGrow: 0 },
  group: {
    fontFamily: fonts.semibold,
    fontSize: 11,
    letterSpacing: 0.8,
    color: colors.mutedForeground,
    paddingHorizontal: space.md,
    paddingTop: space.md,
    paddingBottom: space.xs,
  },
  option: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.md,
    minHeight: 48,
    paddingHorizontal: space.md,
    borderRadius: radius.md,
  },
  optionOn: { backgroundColor: colors.brandSoft },
  optionText: { flex: 1, fontFamily: fonts.regular, fontSize: 16, color: colors.foreground },
  optionTextOn: { fontFamily: fonts.semibold },
  empty: { textAlign: "center", paddingVertical: space.xl },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    minHeight: 38,
    maxWidth: 240,
    paddingHorizontal: space.md,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
  },
  chipOn: { borderColor: colors.brand, backgroundColor: colors.brandSoft },
  chipText: { flexShrink: 1, fontFamily: fonts.medium, fontSize: 14, color: colors.foreground },
  chipTextOn: { color: colors.brand, fontFamily: fonts.semibold },
});
