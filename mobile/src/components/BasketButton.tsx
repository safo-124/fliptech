import { router } from "expo-router";
import { ShoppingBasket } from "lucide-react-native";
import { Pressable, StyleSheet, View } from "react-native";

import { useBasket } from "@/lib/basket";
import { colors, fonts, shadow } from "@/theme/tokens";

import { Text } from "./Text";

/** The basket, top right of the shop and the product page, with how many
    things are in it (the server's count, the same as the website's). */
export function BasketButton({ size = 48 }: { size?: number }) {
  const { count } = useBasket();
  return (
    <Pressable
      onPress={() => router.push("/basket")}
      accessibilityRole="button"
      accessibilityLabel={count ? `Basket, ${count} ${count === 1 ? "item" : "items"}` : "Basket"}
      hitSlop={6}
      style={({ pressed }) => [
        styles.button,
        { width: size, height: size, borderRadius: size / 2 },
        pressed ? { transform: [{ scale: 0.94 }] } : null,
      ]}
    >
      <ShoppingBasket size={22} color={colors.brand} strokeWidth={2.2} />
      {count ? (
        <View style={styles.dot}>
          <Text style={styles.dotText}>{count > 99 ? "99+" : String(count)}</Text>
        </View>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
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
