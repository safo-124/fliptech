import { router } from "expo-router";
import { CloudOff, Handshake, ShoppingBasket, Store, Truck } from "lucide-react-native";
import { useState } from "react";
import { Pressable, RefreshControl, ScrollView, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Button } from "@/components/Form";
import { BasketLineRow } from "@/components/market/BasketLineRow";
import { Row, Way } from "@/components/market/Choice";
import { StackHeader } from "@/components/StackHeader";
import { ErrorState, Skeleton } from "@/components/States";
import { Text } from "@/components/Text";
import { useBasket, type BasketGroup } from "@/lib/basket";
import { cedis } from "@/lib/format";
import { useOnline } from "@/lib/online";
import { colors, fonts, radius, shadow, space } from "@/theme/tokens";

/**
 * The basket, by seller, as the server groups it (the same basket as the
 * website's). Each seller is paid, or sent the order, on their own. Offline,
 * the last basket is shown and checking out waits for the connection.
 */
export default function BasketScreen() {
  const insets = useSafeAreaInsets();
  const basket = useBasket();
  const online = useOnline();
  const [refreshing, setRefreshing] = useState(false);
  const data = basket.basket;

  async function refresh() {
    setRefreshing(true);
    await basket.refresh().catch(() => undefined);
    setRefreshing(false);
  }

  return (
    <View style={styles.screen}>
      <StackHeader eyebrow="MARKETPLACE" title="Your basket" />
      {!online ? (
        <View style={styles.offline} accessibilityLiveRegion="polite">
          <CloudOff size={16} color={colors.warn} />
          <Text style={styles.offlineText}>You&apos;re offline</Text>
        </View>
      ) : null}
      {!data && basket.loading ? (
        <View style={{ padding: space.lg, gap: space.md }}>
          <Skeleton style={{ height: 160 }} />
          <Skeleton style={{ height: 160 }} />
        </View>
      ) : !data ? (
        <ErrorState message="Your basket did not load." onRetry={() => void refresh()} />
      ) : !data.groups.length ? (
        <View style={styles.empty}>
          <View style={styles.emptyIcon}>
            <ShoppingBasket size={36} color={colors.brand} />
          </View>
          <Text variant="title">Your basket is empty</Text>
          <Text variant="small" style={{ textAlign: "center" }}>
            Tools, materials and work made by trained hands. Add something and it waits here.
          </Text>
          <Button label="Back to the marketplace" onPress={() => router.navigate("/shop")} style={{ alignSelf: "stretch" }} />
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={{ padding: space.lg, gap: space.lg, paddingBottom: insets.bottom + space.xl }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} tintColor={colors.brand} />}
        >
          {data.notice ? <Text style={styles.notice}>{data.notice}</Text> : null}
          {data.groups.map((group) => (
            <SellerGroup key={group.seller.id} group={group} online={online} />
          ))}
        </ScrollView>
      )}
    </View>
  );
}

function SellerGroup({ group, online }: { group: BasketGroup; online: boolean }) {
  const [way, setWay] = useState<"pickup" | "delivery">("pickup");
  const handover = group.delivery ? way : "pickup";
  const totals = group.totals[handover];
  const buyable = group.lines.some((line) => line.available);
  const amount = totals ? cedis(totals.plan === "full" ? totals.total : totals.pay_now) : "";
  const label = group.takes_payments
    ? totals?.plan === "deposit" || totals?.plan === "collect"
      ? `Pay deposit ${amount} with MoMo or card`
      : `Pay ${amount} with MoMo or card`
    : `Send order to ${group.seller.business_name}`;

  return (
    <View style={styles.card} testID={`basket-group-${group.seller.id}`}>
      <Pressable onPress={() => router.push(`/shop/${group.seller.id}`)} style={styles.sellerRow} accessibilityRole="link">
        <Store size={18} color={colors.brand} />
        <View style={{ flex: 1 }}>
          <Text variant="heading" numberOfLines={1}>
            {group.seller.business_name}
          </Text>
          <Text variant="small">
            {[group.seller.area, group.seller.verified ? "Checked by Fliiptech" : null].filter(Boolean).join(" · ")}
          </Text>
        </View>
      </Pressable>
      <View>
        {group.lines.map((line) => (
          <BasketLineRow key={line.id} line={line} offline={!online} />
        ))}
      </View>
      {buyable ? (
        <View style={{ gap: space.md }}>
          {group.delivery ? (
            <View style={{ flexDirection: "row", gap: space.sm }}>
              <Way active={handover === "pickup"} onPress={() => setWay("pickup")} icon={<Store size={18} color={colors.brand} />} title="Collect" />
              <Way
                active={handover === "delivery"}
                onPress={() => setWay("delivery")}
                icon={<Truck size={18} color={colors.brand} />}
                title="Delivery"
                detail={`${cedis(group.delivery.fee)} delivery`}
              />
            </View>
          ) : null}
          {totals ? (
            <View style={{ gap: 4 }}>
              <Row label="Subtotal" value={cedis(totals.subtotal)} />
              {handover === "delivery" ? <Row label="Delivery" value={cedis(totals.delivery)} /> : null}
              <Row label="Total" value={cedis(totals.total)} strong />
            </View>
          ) : null}
          {group.problem ? <Text style={styles.problem}>{group.problem}</Text> : null}
          {group.takes_payments ? null : (
            <View style={styles.direct}>
              <Handshake size={18} color={colors.warn} />
              <Text variant="small" style={{ flex: 1 }}>
                This maker takes payment directly. We send them your order and you agree payment and pickup in the
                chat.
              </Text>
            </View>
          )}
          <Button
            label={label}
            disabled={!totals || !online}
            onPress={() => router.push({ pathname: "/checkout", params: { seller: String(group.seller.id), way: handover } })}
          />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  offline: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.sm,
    marginHorizontal: space.lg,
    marginTop: space.sm,
    padding: space.md,
    borderRadius: radius.lg,
    backgroundColor: colors.warnBg,
  },
  offlineText: { fontFamily: fonts.semibold, color: colors.warn },
  notice: { fontFamily: fonts.semibold, color: colors.warn },
  empty: { flex: 1, alignItems: "center", justifyContent: "center", gap: space.md, padding: space.xl },
  emptyIcon: {
    width: 80,
    height: 80,
    borderRadius: 40,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.brandSoft,
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
  sellerRow: { flexDirection: "row", alignItems: "center", gap: space.sm, minHeight: 44 },
  problem: { color: colors.destructive, fontSize: 13 },
  direct: { flexDirection: "row", gap: space.sm, padding: space.md, borderRadius: radius.lg, backgroundColor: colors.warnBg },
});
