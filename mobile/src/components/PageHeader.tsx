import { Search, X } from "lucide-react-native";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Pressable, StyleSheet, TextInput, View } from "react-native";

import { colors, fonts, radius, space } from "@/theme/tokens";

import { Text } from "./Text";

/**
 * A tab's title and its search box. The search runs when the keyboard's
 * search key is pressed, or with `live`, a moment after the visitor stops
 * typing (one request per pause, not per letter: each search costs data).
 */
export function PageHeader({
  eyebrow,
  title,
  placeholder,
  onSearch,
  action,
  live = false,
  initial = "",
}: {
  eyebrow: string;
  title: string;
  placeholder: string;
  onSearch: (words: string) => void;
  /** A button for the top-right corner, such as the map. */
  action?: ReactNode;
  /** Search as the visitor types. */
  live?: boolean;
  initial?: string;
}) {
  const [words, setWords] = useState(initial);
  const first = useRef(true);
  useEffect(() => {
    if (!live) return;
    if (first.current) {
      first.current = false;
      return;
    }
    const timer = setTimeout(() => onSearch(words.trim()), 300);
    return () => clearTimeout(timer);
    // onSearch is the parent's setter; the words are what matter here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [words, live]);
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
