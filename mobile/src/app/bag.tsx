import { Image } from "expo-image";
import { router } from "expo-router";
import { Minus, Plus, ShoppingBag, Store, X } from "lucide-react-native";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Button } from "@/components/Form";
import { StackHeader } from "@/components/StackHeader";
import { Text } from "@/components/Text";
import { bySeller, MAX_QUANTITY, useBag, type BagItem } from "@/lib/bag";
import { cedis } from "@/lib/format";
import { photoUrl } from "@/lib/media";
import { colors, fonts, radius, shadow, space } from "@/theme/tokens";

/**
 * The bag, by seller. Each seller is paid on their own, so each has its own
 * "Check out" — the same as the website's bag.
 */
export default function BagScreen() {
  const insets = useSafeAreaInsets();
  const bag = useBag();
  const groups = bySeller(bag.items);

  return (
    <View style={styles.screen}>
      <StackHeader eyebrow="MARKETPLACE" title="Your bag" />
      {!groups.length ? (
        <View style={styles.empty}>
          <View style={styles.emptyIcon}>
            <ShoppingBag size={36} color={colors.brand} />
          </View>
          <Text variant="title">Your bag is empty</Text>
          <Text variant="small" style={{ textAlign: "center" }}>
            Tools, materials and work made by trained hands. Add something and it waits here.
          </Text>
          <Button label="Go to the shop" onPress={() => router.navigate("/shop")} style={{ alignSelf: "stretch" }} />
        </View>
      ) : (
        <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.lg, paddingBottom: insets.bottom + space.xl }}>
          {groups.map((group) => {
            const subtotal = group.items.reduce((sum, row) => sum + Number(row.price ?? 0) * row.quantity, 0);
            return (
              <View key={group.seller.id} style={styles.card}>
                <View style={styles.sellerRow}>
                  <Store size={18} color={colors.brand} />
                  <Text variant="heading" style={{ flex: 1 }} numberOfLines={1}>
                    {group.seller.business_name}
                  </Text>
                </View>
                {group.items.map((item) => (
                  <Line key={`${item.product}-${item.option}`} item={item} />
                ))}
                <View style={styles.total}>
                  <Text variant="label">About</Text>
                  <Text style={styles.totalAmount}>{cedis(subtotal)}</Text>
                </View>
                <Button
                  label={`Check out with ${group.seller.business_name}`}
                  onPress={() => router.push({ pathname: "/checkout", params: { seller: String(group.seller.id) } })}
                />
              </View>
            );
          })}
          {groups.length > 1 ? (
            <View style={{ gap: space.sm }}>
              <Button
                label={`Check out everything (${groups.length} sellers)`}
                onPress={() => router.push({ pathname: "/checkout", params: { all: "1" } })}
              />
              <Text variant="small" style={{ textAlign: "center" }}>
                Fill in your details once; each seller is paid in turn, straight to them.
              </Text>
            </View>
          ) : null}
        </ScrollView>
      )}
    </View>
  );
}

function Line({ item }: { item: BagItem }) {
  const bag = useBag();
  return (
    <View style={styles.line}>
      <Pressable onPress={() => router.push(`/product/${item.product}`)} style={styles.photo} accessibilityRole="link">
        {item.photo ? (
          <Image source={{ uri: photoUrl(item.photo) ?? undefined }} style={StyleSheet.absoluteFill} contentFit="cover" />
        ) : null}
      </Pressable>
      <View style={{ flex: 1, gap: 2 }}>
        <Text variant="label" numberOfLines={2}>
          {item.name}
        </Text>
        {item.optionLabel ? <Text variant="small">{item.optionLabel}</Text> : null}
        <Text style={styles.price}>{cedis(item.price)}</Text>
        <View style={styles.stepper}>
          <Pressable
            onPress={() => bag.setQuantity(item.product, item.option, item.quantity - 1)}
            disabled={item.quantity <= 1}
            style={[styles.step, item.quantity <= 1 ? { opacity: 0.35 } : null]}
            accessibilityRole="button"
            accessibilityLabel="One fewer"
          >
            <Minus size={16} color={colors.foreground} />
          </Pressable>
          <Text style={styles.count}>{item.quantity}</Text>
          <Pressable
            onPress={() => bag.setQuantity(item.product, item.option, item.quantity + 1)}
            disabled={item.quantity >= MAX_QUANTITY}
            style={styles.step}
            accessibilityRole="button"
            accessibilityLabel="One more"
          >
            <Plus size={16} color={colors.foreground} />
          </Pressable>
        </View>
      </View>
      <Pressable
        onPress={() => bag.remove(item.product, item.option)}
        hitSlop={10}
        accessibilityRole="button"
        accessibilityLabel={`Remove ${item.name}`}
      >
        <X size={18} color={colors.mutedForeground} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  empty: { flex: 1, alignItems: "center", justifyContent: "center", gap: space.md, padding: space.xl },
  emptyIcon: {
    width: 84,
    height: 84,
    borderRadius: 42,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.brandSoft,
  },
  card: {
    padding: space.lg,
    gap: space.md,
    borderRadius: radius.lg,
    backgroundColor: colors.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    ...shadow.card,
  },
  sellerRow: { flexDirection: "row", alignItems: "center", gap: space.sm },
  line: { flexDirection: "row", gap: space.md, alignItems: "flex-start" },
  photo: { width: 76, height: 76, borderRadius: radius.md, overflow: "hidden", backgroundColor: colors.muted },
  price: { fontFamily: fonts.bold, fontSize: 15, color: colors.brandDeep },
  stepper: {
    marginTop: 4,
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
  },
  step: { width: 36, height: 36, alignItems: "center", justifyContent: "center" },
  count: { minWidth: 24, textAlign: "center", fontFamily: fonts.bold, fontSize: 14, color: colors.foreground },
  total: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "baseline",
    paddingTop: space.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  totalAmount: { fontFamily: fonts.extrabold, fontSize: 20, color: colors.brandDeep },
});
