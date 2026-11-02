import { Search, X } from "lucide-react-native";
import { useState, type ReactNode } from "react";
import { Pressable, StyleSheet, TextInput, View } from "react-native";

import { colors, fonts, radius, space } from "@/theme/tokens";

import { Text } from "./Text";

/**
 * A tab's title and its search box. The search runs when the keyboard's
 * search key is pressed, not on every letter: each search costs data.
 */
export function PageHeader({
  eyebrow,
  title,
  placeholder,
  onSearch,
  action,
}: {
  eyebrow: string;
  title: string;
  placeholder: string;
  onSearch: (words: string) => void;
  /** A button for the top-right corner, such as the map. */
  action?: ReactNode;
}) {
  const [words, setWords] = useState("");
  return (
    <View style={styles.wrap}>
      <View style={styles.head}>
        <View style={styles.titles}>
          <Text variant="eyebrow">{eyebrow}</Text>
          <Text variant="display" style={styles.title}>
            {title}
          </Text>
        </View>
        {action}
      </View>
      <View style={styles.search}>
        <Search size={20} color={colors.mutedForeground} />
        <TextInput
          value={words}
          onChangeText={setWords}
          onSubmitEditing={() => onSearch(words.trim())}
          placeholder={placeholder}
          placeholderTextColor={colors.mutedForeground}
          returnKeyType="search"
          accessibilityLabel={placeholder}
          style={styles.input}
        />
        {words ? (
          <Pressable
            onPress={() => {
              setWords("");
              onSearch("");
            }}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel="Clear search"
          >
            <X size={18} color={colors.mutedForeground} />
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: space.lg, paddingTop: space.sm },
  head: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: space.md },
  titles: { flex: 1 },
  title: { marginTop: 4 },
  search: {
    marginTop: space.lg,
    flexDirection: "row",
    alignItems: "center",
    gap: space.sm,
    minHeight: 50,
    paddingHorizontal: space.lg,
    borderRadius: radius.pill,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
  },
  input: { flex: 1, fontFamily: fonts.regular, fontSize: 15, color: colors.foreground, paddingVertical: 12 },
});
