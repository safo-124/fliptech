import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { router } from "expo-router";
import { CircleCheckBig, Hammer, MessageCircle, Package, Phone } from "lucide-react-native";
import { Alert, FlatList, Linking, Pressable, RefreshControl, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { StackHeader } from "@/components/StackHeader";
import { EmptyState, ErrorState, Skeleton } from "@/components/States";
import { Text } from "@/components/Text";
import { ApiError, api } from "@/lib/api";
import { cedis, shortDate } from "@/lib/format";
import type { Order } from "@/lib/types";
import { colors, fonts, radius, shadow, space } from "@/theme/tokens";

/**
 * Opens the chat with a paid order's buyer, so the seller can write first.
 * Beside Call, not instead of it: a buyer who checked out without an account
 * has no chat, and the server says to call them.
 */
async function message(reference: string) {
  try {
    const thread = await api.openOrderChat(reference);
    router.push({ pathname: "/inbox/[id]", params: { id: String(thread.id) } });
  } catch (error) {
    Alert.alert("No chat for this order", error instanceof ApiError ? error.message : "Try again, or call them.");
  }
}

const STAGES: Record<string, { label: string; color: string; bg: string }> = {
  new: { label: "Paid · hand it over", color: colors.warn, bg: colors.warnBg },
  delivered: { label: "Handed over · waiting for the buyer", color: colors.brand, bg: colors.brandSoft },
  received: { label: "Buyer has it", color: colors.visit, bg: colors.visitBg },
  problem: { label: "Problem reported", color: colors.destructive, bg: "#fdecec" },
  refunded: { label: "Refunded", color: colors.mutedForeground, bg: colors.muted },
};

/** The shop's paid orders: who to call, what to hand over, and the buttons
    that move an order on. The same actions as the website's dashboard. */
export default function SellerOrdersScreen() {
  const insets = useSafeAreaInsets();
  const orders = useQuery({ queryKey: ["seller-orders"], queryFn: api.sellerOrders, refetchInterval: 60_000 });

  return (
    <View style={styles.screen}>
      <StackHeader eyebrow="YOUR SHOP" title="Orders" />
      {orders.isPending ? (
        <View style={{ padding: space.lg, gap: space.md }}>
          <Skeleton style={{ height: 150 }} />
          <Skeleton style={{ height: 150 }} />
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
          ListEmptyComponent={<EmptyState title="No orders yet" body="Paid orders for your shop show here." />}
          renderItem={({ item }) => <SellerOrder order={item} />}
        />
      )}
    </View>
  );
}

function SellerOrder({ order }: { order: Order }) {
  const client = useQueryClient();
  const stage = STAGES[order.stage] ?? STAGES.new;
  const items = order.items.length
    ? order.items
    : [{ product_name: order.product_name, quantity: order.quantity, option_label: "" }];
  const waitingToFinish = order.plan === "deposit" && order.balance_status === "waiting";
  const balanceDue = order.plan === "deposit" && order.balance_status === "due";
  const move = useMutation({
    mutationFn: (stageName: "delivered" | "ready") => api.sellerOrderStage(order.reference, stageName),
    onSuccess: () => void client.invalidateQueries({ queryKey: ["seller-orders"] }),
    onError: (error) =>
      Alert.alert("That did not work", error instanceof ApiError ? error.message : "Check your connection and try again."),
  });

  function confirm(stageName: "delivered" | "ready") {
    Alert.alert(
      stageName === "delivered" ? "Mark as handed over?" : "Mark as ready?",
      stageName === "delivered"
        ? `Only once ${order.buyer_name} has it, or it is on its way. They are asked to confirm.`
        : `${order.buyer_name} is asked to pay the balance of ${cedis(order.balance)}.`,
      [
        { text: "Not yet", style: "cancel" },
        { text: "Yes", onPress: () => move.mutate(stageName) },
      ],
    );
  }

  const phone = order.buyer_phone.replace(/[^\d+]/g, "");
  return (
    <View style={styles.card}>
      <View style={styles.top}>
        <View style={styles.icon}>
          <Package size={20} color={colors.brand} />
        </View>
        <View style={{ flex: 1 }}>
          <Text variant="heading" numberOfLines={1}>
            {order.buyer_name}
          </Text>
          <Text variant="small">
            {shortDate(order.paid_at ?? order.created_at ?? "")} · {order.reference} ·{" "}
            {order.fulfilment === "delivery" ? "Deliver" : "Collect"}
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
      {order.note ? <Text variant="small">Note: “{order.note}”</Text> : null}
      {order.problem ? <Text variant="small" style={{ color: colors.destructive }}>Problem: “{order.problem}”</Text> : null}

      <View style={[styles.stage, { backgroundColor: stage.bg }]}>
        <Text style={[styles.stageText, { color: stage.color }]}>
          {waitingToFinish ? "Deposit paid · make it, then mark it ready" : balanceDue ? "Waiting for the balance" : stage.label}
        </Text>
      </View>

      <View style={styles.actions}>
        <Pressable onPress={() => void Linking.openURL(`tel:${phone}`)} style={styles.action} accessibilityRole="button">
          <Phone size={16} color={colors.brand} />
          <Text style={styles.actionText}>Call</Text>
        </Pressable>
        <Pressable onPress={() => void message(order.reference)} style={styles.action} accessibilityRole="button">
          <MessageCircle size={16} color={colors.brand} />
          <Text style={styles.actionText}>Message</Text>
        </Pressable>
        {order.stage === "new" && waitingToFinish ? (
          <Pressable onPress={() => confirm("ready")} disabled={move.isPending} style={[styles.action, styles.primary]} accessibilityRole="button">
            <Hammer size={16} color="#fff" />
            <Text style={[styles.actionText, { color: "#fff" }]}>Ready</Text>
          </Pressable>
        ) : order.stage === "new" && !balanceDue ? (
          <Pressable onPress={() => confirm("delivered")} disabled={move.isPending} style={[styles.action, styles.primary]} accessibilityRole="button">
            <CircleCheckBig size={16} color="#fff" />
            <Text style={[styles.actionText, { color: "#fff" }]}>Handed over</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
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
  icon: { width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center", backgroundColor: colors.brandSoft },
  amount: { fontFamily: fonts.extrabold, fontSize: 17, color: colors.brandDeep },
  stage: { alignSelf: "flex-start", paddingHorizontal: space.sm, paddingVertical: 4, borderRadius: radius.pill, marginTop: 4 },
  stageText: { fontFamily: fonts.semibold, fontSize: 12 },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: space.sm, marginTop: space.sm },
  action: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    minHeight: 40,
    paddingHorizontal: space.md,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
  },
  primary: { backgroundColor: colors.brand, borderColor: colors.brand },
  actionText: { fontFamily: fonts.semibold, fontSize: 14, color: colors.brand },
});
