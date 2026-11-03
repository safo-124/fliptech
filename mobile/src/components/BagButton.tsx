import { router } from "expo-router";
import { ShoppingBag } from "lucide-react-native";
import { Pressable, StyleSheet, View } from "react-native";

import { useBag } from "@/lib/bag";
import { colors, fonts, shadow } from "@/theme/tokens";

import { Text } from "./Text";

/** The bag, top right of the shop, with how many things are in it. */
export function BagButton() {
  const { count } = useBag();
  return (
    <Pressable
      onPress={() => router.push("/bag")}
      accessibilityRole="button"
      accessibilityLabel={count ? `Bag, ${count} things` : "Bag"}
      hitSlop={6}
      style={({ pressed }) => [styles.button, pressed ? { transform: [{ scale: 0.94 }] } : null]}
    >
      <ShoppingBag size={22} color={colors.brand} strokeWidth={2.2} />
      {count ? (
        <View style={styles.dot}>
          <Text style={styles.dotText}>{String(count)}</Text>
        </View>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    ...shadow.card,
  },
  dot: {
    position: "absolute",
    top: 2,
    right: 2,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    paddingHorizontal: 4,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.brandPink,
  },
  dotText: { fontFamily: fonts.bold, fontSize: 11, color: "#fff" },
});
