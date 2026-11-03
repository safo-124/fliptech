import { useQuery } from "@tanstack/react-query";
import { useLocalSearchParams } from "expo-router";
import { CircleCheckBig, Package, Phone } from "lucide-react-native";
import { FlatList, Linking, Pressable, RefreshControl, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { StackHeader } from "@/components/StackHeader";
import { EmptyState, ErrorState, Skeleton } from "@/components/States";
import { Text } from "@/components/Text";
import { api } from "@/lib/api";
import { cedis, shortDate } from "@/lib/format";
import { openOnSite } from "@/lib/open";
import type { Order } from "@/lib/types";
import { colors, fonts, radius, shadow, space } from "@/theme/tokens";

const STAGES: Record<string, { label: string; color: string; bg: string }> = {
  new: { label: "Paid · waiting for handover", color: colors.warn, bg: colors.warnBg },
  delivered: { label: "Handed over", color: colors.brand, bg: colors.brandSoft },
  received: { label: "You have it", color: colors.visit, bg: colors.visitBg },
  problem: { label: "Problem reported", color: colors.destructive, bg: "#fdecec" },
  refunded: { label: "Refunded", color: colors.mutedForeground, bg: colors.muted },
};

/** Everything paid for with this phone, on the app or the website. */
export default function OrdersScreen() {
  const { paid } = useLocalSearchParams<{ paid?: string }>();
  const insets = useSafeAreaInsets();
  const orders = useQuery({ queryKey: ["orders"], queryFn: api.myOrders });

  return (
    <View style={styles.screen}>
      <StackHeader eyebrow="MARKETPLACE" title="My orders" />
      {paid ? (
        <View style={styles.paid}>
          <CircleCheckBig size={22} color={colors.visit} />
          <Text variant="label" style={{ flex: 1, color: colors.visit }}>
            Paid. The seller has been told and will call you to hand it over.
          </Text>
        </View>
      ) : null}
      {orders.isPending ? (
        <View style={{ padding: space.lg, gap: space.md }}>
          <Skeleton style={{ height: 120 }} />
          <Skeleton style={{ height: 120 }} />
        </View>
      ) : orders.isError ? (
        <ErrorState message="Your orders did not load." onRetry={() => void orders.refetch()} />
      ) : (
        <FlatList
          data={orders.data.results}
          keyExtractor={(order) => order.reference}
          contentContainerStyle={{ padding: space.lg, gap: space.md, paddingBottom: insets.bottom + space.xl }}
          refreshControl={
            <RefreshControl refreshing={orders.isRefetching} onRefresh={() => void orders.refetch()} tintColor={colors.brand} />
          }
          ListEmptyComponent={<EmptyState title="No orders yet" body="Things you pay for in the shop show here." />}
          renderItem={({ item }) => <OrderCard order={item} />}
        />
      )}
    </View>
  );
}

function OrderCard({ order }: { order: Order }) {
  const stage = STAGES[order.stage] ?? STAGES.new;
  const items = order.items.length ? order.items : [{ product_name: order.product_name, quantity: order.quantity, option_label: "" }];
  return (
    <Pressable
      onPress={() => void openOnSite(`/marketplace/order/${order.reference}`)}
      style={({ pressed }) => [styles.card, pressed ? { opacity: 0.85 } : null]}
      accessibilityRole="link"
    >
      <View style={styles.top}>
        <View style={styles.icon}>
          <Package size={20} color={colors.brand} />
        </View>
        <View style={{ flex: 1 }}>
          <Text variant="heading" numberOfLines={1}>
            {order.seller_name}
          </Text>
          <Text variant="small">
            {shortDate(order.paid_at ?? order.created_at)} · {order.reference}
          </Text>
        </View>
        <Text style={styles.amount}>{cedis(order.amount)}</Text>
      </View>
      {items.map((item, index) => (
        <Text key={index} variant="small" numberOfLines={1}>
          {item.quantity} × {item.product_name}
          {item.option_label ? ` (${item.option_label})` : ""}
        </Text>
      ))}
      <View style={styles.foot}>
        <View style={[styles.stage, { backgroundColor: stage.bg }]}>
          <Text style={[styles.stageText, { color: stage.color }]}>{stage.label}</Text>
        </View>
        {order.seller_phone ? (
          <Pressable
            onPress={() => void Linking.openURL(`tel:${order.seller_phone}`)}
            style={styles.call}
            hitSlop={6}
            accessibilityRole="button"
            accessibilityLabel={`Call ${order.seller_name}`}
          >
            <Phone size={16} color={colors.brand} />
            <Text style={styles.callText}>Call</Text>
          </Pressable>
        ) : null}
      </View>
      {order.plan === "deposit" && order.balance_status !== "paid" ? (
        <Text variant="small">
          Deposit paid. {cedis(order.balance)} is due when it is ready.
        </Text>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  paid: {
    marginHorizontal: space.lg,
    flexDirection: "row",
    alignItems: "center",
    gap: space.md,
    padding: space.md,
    borderRadius: radius.lg,
    backgroundColor: colors.visitBg,
  },
  card: {
    gap: space.sm,
    padding: space.lg,
    borderRadius: radius.lg,
    backgroundColor: colors.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    ...shadow.card,
  },
  top: { flexDirection: "row", alignItems: "center", gap: space.md },
  icon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.brandSoft,
  },
  amount: { fontFamily: fonts.extrabold, fontSize: 17, color: colors.brandDeep },
  foot: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 4 },
  stage: { paddingHorizontal: space.sm, paddingVertical: 4, borderRadius: radius.pill },
  stageText: { fontFamily: fonts.semibold, fontSize: 12 },
  call: { flexDirection: "row", alignItems: "center", gap: 4 },
  callText: { fontFamily: fonts.semibold, fontSize: 14, color: colors.brand },
});
