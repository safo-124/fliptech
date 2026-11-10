import { router } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Image } from "expo-image";
import { BadgeCheck, IdCard, ShieldCheck } from "lucide-react-native";
import { Pressable, RefreshControl, ScrollView, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Button } from "@/components/Form";
import { StackHeader } from "@/components/StackHeader";
import { Skeleton } from "@/components/States";
import { Text } from "@/components/Text";
import { api } from "@/lib/api";
import { cedis, shortDate } from "@/lib/format";
import { photoUrl } from "@/lib/media";
import { openOnSite } from "@/lib/open";
import type { SellerProduct } from "@/lib/types";
import { colors, fonts, radius, space } from "@/theme/tokens";

const LEVELS = [
  { key: "confirmed", label: "Confirmed" },
  { key: "payments", label: "Payments checked" },
  { key: "verified", label: "Verified maker" },
] as const;

const WAITING: Record<string, string> = {
  handover: "Paid when you hand it over and the buyer confirms",
  buyer: "Waiting for the buyer to confirm",
  problem: "A problem was reported: Fliiptech decides",
};

/**
 * The seller's shop, the parts a phone needs: their level and ID check,
 * where their money is (paid out, held and when, refunded), and stock with
 * a quick Sold out switch. The full dashboard is on the website.
 */
export default function SellerScreen() {
  const insets = useSafeAreaInsets();
  const client = useQueryClient();
  const payouts = useQuery({ queryKey: ["seller-payouts"], queryFn: api.sellerPayouts });
  const id = useQuery({ queryKey: ["seller-id"], queryFn: api.sellerId });
  const products = useQuery({
    queryKey: ["seller-products"],
    queryFn: async () => {
      const found = await api.sellerProducts();
      return Array.isArray(found) ? found : found.results;
    },
  });
  const toggle = useMutation({
    mutationFn: (product: SellerProduct) =>
      api.updateSellerProduct(product.id, {
        availability: product.availability === "sold_out" ? "available" : "sold_out",
        ...(product.availability === "sold_out" && product.stock === 0 ? { stock: null } : {}),
      }),
    onSuccess: () => void client.invalidateQueries({ queryKey: ["seller-products"] }),
  });

  const level = payouts.data?.level ?? id.data?.level ?? "confirmed";
  const reached = LEVELS.findIndex((row) => row.key === level);

  return (
    <View style={styles.screen}>
      <StackHeader eyebrow="MY SHOP" title="Sales and stock" />
      <ScrollView
        contentContainerStyle={{ padding: space.lg, gap: space.lg, paddingBottom: insets.bottom + space.xl }}
        refreshControl={
          <RefreshControl
            refreshing={payouts.isRefetching}
            onRefresh={() => {
              void payouts.refetch();
              void products.refetch();
              void id.refetch();
            }}
            tintColor={colors.brand}
          />
        }
      >
        <View style={styles.card}>
          <View style={styles.levels}>
            {LEVELS.map((row, index) => (
              <View key={row.key} style={[styles.level, index <= reached ? styles.levelOn : null]}>
                {row.key === "payments" ? (
                  <ShieldCheck size={16} color={index <= reached ? colors.visit : colors.mutedForeground} />
                ) : (
                  <BadgeCheck size={16} color={index <= reached ? colors.visit : colors.mutedForeground} />
                )}
                <Text style={[styles.levelText, index <= reached ? { color: colors.visit } : null]}>{row.label}</Text>
              </View>
            ))}
          </View>
          {id.data && id.data.status !== "checked" ? (
            <View style={{ gap: space.sm, marginTop: space.md }}>
              <Text variant="small">
                {id.data.status === "submitted"
                  ? "Your ID is with Fliiptech staff. We text you when it is checked."
                  : "Send your ID so buyers can pay you on the site. It stays private."}
              </Text>
              {id.data.status !== "submitted" ? (
                <Button
                  label="Send my ID"
                  tone="soft"
                  icon={<IdCard size={16} color={colors.brand} />}
                  onPress={() => void openOnSite("/sell/shop")}
                />
              ) : null}
            </View>
          ) : null}
        </View>

        <Text variant="heading">Your money</Text>
        {payouts.isPending ? (
          <Skeleton style={{ height: 90 }} />
        ) : payouts.data ? (
          <>
            <View style={styles.tiles}>
              <Tile label="Paid out" value={payouts.data.totals.paid_out} color={colors.visit} />
              <Tile label="Held" value={payouts.data.totals.held} color={colors.warn} />
              <Tile label="Refunded" value={payouts.data.totals.refunded} color={colors.mutedForeground} />
            </View>
            {payouts.data.results.slice(0, 20).map((row) => (
              <View key={row.reference} style={styles.row}>
                <View style={{ flex: 1 }}>
                  <Text variant="label" numberOfLines={1}>
                    {row.product}
                  </Text>
                  <Text variant="small">
                    {shortDate(row.paid_at)} ·{" "}
                    {row.state === "held"
                      ? row.due
                        ? `Due ${shortDate(row.due)}`
                        : WAITING[row.waiting_for] ?? "Held"
                      : row.state === "paid_out"
                        ? "Paid out"
                        : "Refunded"}
                  </Text>
                </View>
                <Text style={[styles.amount, row.state === "held" ? { color: colors.warn } : null]}>{cedis(row.yours)}</Text>
              </View>
            ))}
            {!payouts.data.results.length ? <Text variant="small">No paid orders yet.</Text> : null}
          </>
        ) : null}

        <Text variant="heading">Stock</Text>
        {(products.data ?? []).map((product) => (
          <View key={product.id} style={styles.row}>
            <View style={styles.thumb}>
              {product.photos[0]?.image ? (
                <Image source={photoUrl(product.photos[0].image)} style={StyleSheet.absoluteFill} contentFit="cover" />
              ) : null}
            </View>
            <View style={{ flex: 1 }}>
              <Text variant="label" numberOfLines={1}>
                {product.name}
              </Text>
              <Text variant="small" style={product.stock !== null && product.stock <= 2 ? { color: colors.warn } : null}>
                {product.availability === "sold_out"
                  ? "Sold out"
                  : product.stock !== null
                    ? `${product.stock} left`
                    : "In stock"}
              </Text>
            </View>
            <Pressable
              onPress={() => toggle.mutate(product)}
              style={[styles.switch, product.availability === "sold_out" ? styles.switchOff : null]}
              accessibilityRole="switch"
              accessibilityState={{ checked: product.availability !== "sold_out" }}
              accessibilityLabel={`${product.name} in stock`}
            >
              <Text style={styles.switchText}>{product.availability === "sold_out" ? "Sold out" : "In stock"}</Text>
            </Pressable>
          </View>
        ))}
        <View style={{ flexDirection: "row", gap: space.sm }}>
          <Button label="Orders" onPress={() => router.push("/seller/orders")} style={{ flex: 1 }} />
          <Button label="Messages" tone="outline" onPress={() => router.push("/seller/chats")} style={{ flex: 1 }} />
        </View>
        {/* Adding products with photos, and sending an ID, are on the
            website for now: both upload pictures. */}
        <Button label="Add products on the website" tone="soft" onPress={() => void openOnSite("/sell/shop")} />
      </ScrollView>
    </View>
  );
}

function Tile({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <View style={styles.tile}>
      <Text variant="small">{label}</Text>
      <Text style={[styles.tileValue, { color }]}>{cedis(value)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  card: { padding: space.lg, borderRadius: radius.lg, backgroundColor: colors.card, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
  levels: { flexDirection: "row", gap: space.sm },
  level: { flex: 1, alignItems: "center", gap: 4, padding: space.sm, borderRadius: radius.md, backgroundColor: colors.muted },
  levelOn: { backgroundColor: colors.visitBg },
  levelText: { fontFamily: fonts.semibold, fontSize: 11, textAlign: "center", color: colors.mutedForeground },
  tiles: { flexDirection: "row", gap: space.sm },
  tile: { flex: 1, padding: space.md, borderRadius: radius.lg, backgroundColor: colors.card, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
  tileValue: { fontFamily: fonts.extrabold, fontSize: 17, marginTop: 2 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.md,
    padding: space.md,
    borderRadius: radius.lg,
    backgroundColor: colors.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  amount: { fontFamily: fonts.bold, fontSize: 15, color: colors.foreground },
  thumb: { width: 44, height: 44, borderRadius: 10, overflow: "hidden", backgroundColor: colors.muted },
  switch: { minWidth: 84, alignItems: "center", paddingVertical: 8, borderRadius: radius.pill, backgroundColor: colors.visit },
  switchOff: { backgroundColor: colors.mutedForeground },
  switchText: { fontFamily: fonts.bold, fontSize: 12, color: "#ffffff" },
});
