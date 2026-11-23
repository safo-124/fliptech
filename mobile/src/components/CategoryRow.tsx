import { useQuery } from "@tanstack/react-query";
import { Pressable, ScrollView, StyleSheet } from "react-native";

import { Text } from "@/components/Text";
import { api } from "@/lib/api";
import { categoriesFor, categoryIcon, type CategoryList } from "@/lib/categories";
import type { TradeCategory } from "@/lib/types";
import { colors, fonts, radius, space } from "@/theme/tokens";

/**
 * A row of trade categories to narrow a list by ("Engineering & Technical
 * Trades", "Fashion, Beauty & Leather Craft"), above Explore, Learn and the
 * shop. Only categories with something in that list are offered, and the row
 * is left out while there are fewer than two: one is no choice to make.
 */
export function CategoryRow({
  list,
  selected,
  onSelect,
}: {
  list: CategoryList;
  selected?: string;
  onSelect: (slug: string | undefined) => void;
}) {
  const categories = useQuery({
    queryKey: ["trade-categories"],
    queryFn: api.tradeCategories,
    staleTime: 10 * 60_000,
  });
  return <CategoryChips categories={categoriesFor(categories.data, list)} selected={selected} onSelect={onSelect} />;
}

/** The chips themselves, for the categories given. */
export function CategoryChips({
  categories,
  selected,
  onSelect,
}: {
  categories: TradeCategory[];
  selected?: string;
  onSelect: (slug: string | undefined) => void;
}) {
  if (categories.length < 2 && !selected) return null;
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.row}
      style={{ marginTop: space.md }}
      accessibilityLabel="Categories"
    >
      <Chip label="All" on={!selected} onPress={() => onSelect(undefined)} />
      {categories.map((category) => {
        const Icon = categoryIcon(category.icon);
        const on = selected === category.slug;
        return (
          <Chip
            key={category.slug}
            label={category.name}
            on={on}
            onPress={() => onSelect(on ? undefined : category.slug)}
            icon={<Icon size={15} color={on ? "#ffffff" : colors.brand} />}
          />
        );
      })}
    </ScrollView>
  );
}

function Chip({ label, on, onPress, icon }: { label: string; on: boolean; onPress: () => void; icon?: React.ReactNode }) {
  return (
    <Pressable
      onPress={onPress}
      style={[styles.chip, on ? styles.chipOn : null]}
      accessibilityRole="button"
      accessibilityState={{ selected: on }}
      accessibilityLabel={label}
    >
      {icon}
      <Text style={[styles.text, on ? { color: "#ffffff" } : null]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { paddingHorizontal: space.lg, gap: space.sm },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    minHeight: 40,
    paddingHorizontal: space.md,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
  },
  chipOn: { backgroundColor: colors.brand, borderColor: colors.brand },
  text: { fontFamily: fonts.semibold, fontSize: 13, color: colors.foreground },
});
