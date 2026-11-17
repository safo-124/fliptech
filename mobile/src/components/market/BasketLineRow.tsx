import { Image } from "expo-image";
import { router } from "expo-router";
import { Hammer, TriangleAlert } from "lucide-react-native";
import { useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";

import { Text } from "@/components/Text";
import { ApiError } from "@/lib/api";
import { useBasket, type BasketLine } from "@/lib/basket";
import { cedis } from "@/lib/format";
import { photoUrl } from "@/lib/media";
import { colors, fonts, radius, space } from "@/theme/tokens";

import { Stepper } from "./Stepper";

/** One line of the basket, on the basket and checkout screens: photo, name,
    price, − / + (1 up to what is left), Remove, and what the server says
    about it (no longer available, price changed, made to order). */
export function BasketLineRow({ line, offline = false }: { line: BasketLine; offline?: boolean }) {
  const basket = useBasket();
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  async function run(change: () => Promise<unknown>) {
    setBusy(true);
    setProblem(null);
    try {
      await change();
    } catch (error) {
      setProblem(error instanceof ApiError ? error.message : "That did not work. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={[styles.line, !line.available ? { opacity: 0.7 } : null]} testID={`basket-line-${line.id}`}>
      <Pressable onPress={() => router.push(`/product/${line.product}`)} style={styles.thumb} accessibilityRole="link">
        <Image source={photoUrl(line.photo)} style={StyleSheet.absoluteFill} contentFit="cover" />
      </Pressable>
      <View style={{ flex: 1, gap: 2 }}>
        <Text variant="label" numberOfLines={2}>
          {line.name}
          {line.option_label ? ` (${line.option_label})` : ""}
        </Text>
        {line.available ? (
          <Text variant="small">
            {line.unit_price ? `${cedis(line.unit_price)} each` : ""}
            {line.line_total && line.quantity > 1 ? ` · ${cedis(line.line_total)}` : ""}
          </Text>
        ) : (
          <Text style={styles.gone}>No longer available</Text>
        )}
        {line.price_changed ? (
          <View style={styles.row}>
            <TriangleAlert size={14} color={colors.warn} />
            <Text style={styles.warn}>
              Price changed from {cedis(line.price_changed.from)} to {cedis(line.price_changed.to)}
            </Text>
          </View>
        ) : null}
        {line.available && line.few_left ? <Text style={styles.warn}>Only {line.few_left} left</Text> : null}
        {line.made_to_order ? (
          <View style={styles.row}>
            <Hammer size={14} color={colors.mutedForeground} />
            <Text variant="small">
              {line.made_to_order.days
                ? `About ${line.made_to_order.days} ${line.made_to_order.days === 1 ? "day" : "days"} to make`
                : "Made to order"}
              {line.made_to_order.deposit ? ` · Deposit ${cedis(line.made_to_order.deposit)} now` : ""}
            </Text>
          </View>
        ) : null}
        <View style={[styles.row, { marginTop: space.xs, gap: space.sm }]}>
          {line.available ? (
            <Stepper
              value={line.quantity}
              max={line.max_quantity}
              disabled={busy || offline}
              onChange={(next) => void run(() => basket.setQuantity(line.id, next))}
            />
          ) : null}
          <Pressable
            onPress={() => void run(() => basket.remove(line.id))}
            disabled={busy || offline}
            accessibilityRole="button"
            accessibilityLabel={`Remove ${line.name}`}
            style={styles.remove}
          >
            <Text style={styles.removeText}>Remove</Text>
          </Pressable>
        </View>
        {problem ? <Text style={styles.problem}>{problem}</Text> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  line: { flexDirection: "row", gap: space.md, paddingVertical: space.md },
  thumb: { width: 72, height: 72, borderRadius: radius.md, overflow: "hidden", backgroundColor: colors.muted },
  row: { flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" },
  gone: { fontFamily: fonts.semibold, fontSize: 13, color: colors.destructive },
  warn: { fontFamily: fonts.semibold, fontSize: 13, color: colors.warn },
  remove: { minHeight: 44, justifyContent: "center", paddingHorizontal: space.sm },
  removeText: { fontFamily: fonts.semibold, fontSize: 14, color: colors.mutedForeground, textDecorationLine: "underline" },
  problem: { fontSize: 13, color: colors.destructive },
});
