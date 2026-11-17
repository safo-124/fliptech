import { router } from "expo-router";
import { Plus } from "lucide-react-native";
import { useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet } from "react-native";

import { useBasket } from "@/lib/basket";
import { colors, shadow } from "@/theme/tokens";

import { showBasketToast } from "./BasketToast";

/** The "+" on a product card: one of it into the basket and a toast. A
    product that needs a size or colour (or cannot be added) opens its page,
    which says why. */
export function QuickAdd({ productId, name }: { productId: number; name: string }) {
  const basket = useBasket();
  const [busy, setBusy] = useState(false);

  async function add() {
    setBusy(true);
    try {
      const next = await basket.add(productId, null, 1);
      showBasketToast(next.notice || undefined);
    } catch {
      router.push(`/product/${productId}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Pressable
      onPress={() => void add()}
      disabled={busy}
      accessibilityRole="button"
      accessibilityLabel={`Add ${name} to your basket`}
      hitSlop={4}
      style={({ pressed }) => [styles.button, pressed ? { transform: [{ scale: 0.92 }] } : null]}
    >
      {busy ? <ActivityIndicator color="#fff" size="small" /> : <Plus size={20} color="#fff" strokeWidth={2.6} />}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.brand,
    ...shadow.card,
  },
});
