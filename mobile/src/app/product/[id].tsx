import { useQuery } from "@tanstack/react-query";
import { router, useLocalSearchParams } from "expo-router";
import { GraduationCap, Handshake, MessageSquare, Minus, Plus, ShieldCheck, Store, Zap } from "lucide-react-native";
import { useState } from "react";
import { Alert, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { BackBar } from "@/components/BackBar";
import { Button } from "@/components/Form";
import { PhotoPager } from "@/components/PhotoPager";
import { ErrorState, Skeleton } from "@/components/States";
import { Text } from "@/components/Text";
import { Heart } from "@/components/market/Heart";
import { PickupCard } from "@/components/market/PickupCard";
import { ApiError, api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { BasketButton } from "@/components/BasketButton";
import { showBasketToast } from "@/components/market/BasketToast";
import { useBasket } from "@/lib/basket";
import { SITE_URL } from "@/lib/config";
import { cedis } from "@/lib/format";
import { colors, fonts, radius, shadow, space } from "@/theme/tokens";

const AVAILABILITY = {
  available: { label: "In stock", color: colors.visit, bg: colors.visitBg },
  made_to_order: { label: "Made to order", color: colors.warn, bg: colors.warnBg },
  sold_out: { label: "Sold out", color: colors.mutedForeground, bg: colors.muted },
} as const;

/** A product: photos, options, how many, then into the basket (or straight
    to checkout with this maker with "Order now"). */
const MAX_QUANTITY = 20;
export default function ProductScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const basket = useBasket();
  const [adding, setAdding] = useState<"add" | "order" | null>(null);
  const auth = useAuth();
  const product = useQuery({ queryKey: ["product", id], queryFn: () => api.product(id) });
  const [optionId, setOptionId] = useState<number | null>(null);
  const [quantity, setQuantity] = useState(1);

  if (product.isError) {
    return (
      <View style={[styles.screen, { paddingTop: insets.top + 80 }]}>
        <BackBar />
        <ErrorState message="This product did not load." onRetry={() => void product.refetch()} />
      </View>
    );
  }

  const data = product.data;
  const options = data?.options ?? [];
  const option = options.find((row) => row.id === optionId) ?? null;
  const needsOption = options.some((row) => row.available);
  const price = option?.price ?? data?.price ?? null;
  // "Only N left": no more than that can be ordered.
  const most = Math.min(MAX_QUANTITY, data?.few_left ?? MAX_QUANTITY);
  // A seller cannot buy or order their own item (the server refuses it too).
  const own = Boolean(data && auth.roles?.seller?.id === data.seller.id);
  const soldOut = data?.availability === "sold_out";
  const depositPercent =
    data?.availability === "made_to_order" && data.seller.deposit_percent ? data.seller.deposit_percent : null;
  const lineTotal = Number(price ?? 0) * quantity;
  // The addresses as the API gives them: PhotoPager sends each through the
  // resizer itself, and a resizer address sent through it again is refused.
  const photos = (data?.photos.length ? data.photos.map((photo) => photo.image) : [data?.photo]).filter(
    (url): url is string => Boolean(url),
  );

  function message() {
    if (!data) return;
    if (!auth.signedIn) {
      router.push({ pathname: "/sign-in", params: { why: "to message sellers" } });
      return;
    }
    router.push({
      pathname: "/chats/new",
      params: {
        seller: String(data.seller.id),
        name: data.seller.business_name,
        product: String(data.id),
        productName: data.name,
      },
    });
  }

  /** "Get told when it is back", from the app: the signed-in phone number. */
  async function waitForStock() {
    if (!data) return;
    if (!auth.signedIn || !auth.account) {
      router.push({ pathname: "/sign-in", params: { why: "to be told when it is back" } });
      return;
    }
    try {
      const reply = await api.stockAlert(data.id, auth.account.phone);
      Alert.alert("Done", reply.detail);
    } catch (error) {
      Alert.alert("That did not work", error instanceof ApiError ? error.message : "Check your connection and try again.");
    }
  }

  /** Into the basket on the server; "order" goes on to checkout. */
  async function put(then: "add" | "order") {
    if (!data) return;
    setAdding(then);
    try {
      const next = await basket.add(data.id, option?.id ?? null, quantity);
      if (then === "order") router.push({ pathname: "/checkout", params: { seller: String(data.seller.id) } });
      else showBasketToast(next.notice || undefined);
    } catch (error) {
      Alert.alert("That did not work", error instanceof ApiError ? error.message : "Check your connection and try again.");
    } finally {
      setAdding(null);
    }
  }

  return (
    <View style={styles.screen}>
      <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + 120 }}>
        {data ? (
          <PhotoPager photos={photos} height={360} />
        ) : (
          <Skeleton style={{ height: 360, borderRadius: 0 }} />
        )}
        <View style={styles.sheet}>
          {!data ? (
            <View style={{ gap: space.md }}>
              <Skeleton style={{ height: 26, width: "80%" }} />
              <Skeleton style={{ height: 30, width: "35%" }} />
              <Skeleton style={{ height: 120 }} />
            </View>
          ) : (
            <>
              <View style={{ flexDirection: "row", gap: space.sm }}>
                <View style={[styles.badge, { backgroundColor: AVAILABILITY[data.availability].bg }]}>
                  <Text style={[styles.badgeText, { color: AVAILABILITY[data.availability].color }]}>
                    {AVAILABILITY[data.availability].label}
                  </Text>
                </View>
                {data.condition === "used" ? (
                  <View style={[styles.badge, { backgroundColor: colors.warnBg }]}>
                    <Text style={[styles.badgeText, { color: colors.warn }]}>Second-hand</Text>
                  </View>
                ) : null}
              </View>
              <View style={{ flexDirection: "row", alignItems: "flex-start", gap: space.md, marginTop: space.sm }}>
                <Text variant="title" style={{ flex: 1 }}>
                  {data.name}
                </Text>
                <Heart productId={data.id} size={40} />
              </View>
              {data.few_left ? (
                <Text style={{ color: colors.warn, fontFamily: fonts.bold, marginTop: 4 }}>Only {data.few_left} left</Text>
              ) : null}
              <View style={styles.priceRow}>
                <Text style={styles.price}>{price ? cedis(price) : "Ask for price"}</Text>
                {data.was_price && !option ? <Text style={styles.was}>{cedis(data.was_price)}</Text> : null}
              </View>

              <Pressable
                onPress={() => router.push(`/shop/${data.seller.id}`)}
                style={styles.seller}
                accessibilityRole="link"
              >
                <View style={styles.sellerIcon}>
                  <Store size={18} color={colors.brand} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text variant="label">{data.seller.business_name}</Text>
                  {data.seller.area ? <Text variant="small">{data.seller.area}</Text> : null}
                </View>
              </Pressable>

              {own ? (
                <View style={[styles.protect, { backgroundColor: colors.brandSoft }]}>
                  <Store size={20} color={colors.brand} />
                  <Text variant="small" style={{ flex: 1 }}>
                    This is your item. Buyers see the buttons to order it here; you cannot order your own.
                  </Text>
                </View>
              ) : null}

              {data.seller.student_discount && data.seller.workshop ? (
                <View style={styles.student}>
                  <GraduationCap size={18} color={colors.visit} />
                  <Text variant="small" style={{ flex: 1, color: colors.visit }}>
                    Trainees of {data.seller.workshop.name} get {data.seller.student_discount}% off here. Sign in with the
                    phone you trained with and it is taken off at checkout.
                  </Text>
                </View>
              ) : null}

              {data.pickup ? <PickupCard pickup={data.pickup} /> : null}

              {options.length ? (
                <View style={{ marginTop: space.xl, gap: space.sm }}>
                  <Text variant="label">Choose one</Text>
                  <View style={styles.chips}>
                    {options.map((row) => (
                      <Pressable
                        key={row.id}
                        disabled={!row.available}
                        onPress={() => setOptionId(row.id)}
                        accessibilityRole="radio"
                        accessibilityState={{ checked: row.id === optionId, disabled: !row.available }}
                        style={[
                          styles.chip,
                          row.id === optionId ? styles.chipOn : null,
                          !row.available ? styles.chipOff : null,
                        ]}
                      >
                        <Text style={[styles.chipText, row.id === optionId ? { color: "#fff" } : null]}>
                          {row.label}
                          {row.price ? ` · ${cedis(row.price)}` : ""}
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                </View>
              ) : null}

              {!own && !soldOut ? (
                <View style={styles.quantityRow}>
                  <Text variant="label">How many</Text>
                  <View style={styles.stepper}>
                    <Pressable
                      onPress={() => setQuantity((n) => Math.max(1, n - 1))}
                      style={styles.step}
                      accessibilityRole="button"
                      accessibilityLabel="One fewer"
                    >
                      <Minus size={18} color={colors.foreground} />
                    </Pressable>
                    <Text style={styles.count}>{quantity}</Text>
                    <Pressable
                      onPress={() => setQuantity((n) => Math.min(most, n + 1))}
                      disabled={quantity >= most}
                      style={[styles.step, quantity >= most ? { opacity: 0.35 } : null]}
                      accessibilityRole="button"
                      accessibilityLabel="One more"
                    >
                      <Plus size={18} color={colors.foreground} />
                    </Pressable>
                  </View>
                </View>
              ) : null}

              {data.availability === "made_to_order" && data.make_days ? (
                <Text variant="small" style={{ marginTop: space.sm }}>
                  About {data.make_days} {data.make_days === 1 ? "day" : "days"} to make
                </Text>
              ) : null}
              {depositPercent && price && data.buy_online && !own ? (
                <Text style={styles.deposit}>
                  Pay deposit {cedis((lineTotal * depositPercent) / 100)} now,{" "}
                  {cedis(lineTotal - (lineTotal * depositPercent) / 100)} when ready
                </Text>
              ) : null}

              {data.description ? (
                <View style={{ marginTop: space.xl }}>
                  <Text variant="heading">About it</Text>
                  <Text style={{ marginTop: space.sm, color: colors.mutedForeground }}>{data.description}</Text>
                </View>
              ) : null}

              {/* Buyer protection only where it applies: paying on the site.
                  Asking the seller means paying them directly, as the
                  website says on the same product. */}
              {own ? null : data.buy_online ? (
                <View style={styles.protect}>
                  <ShieldCheck size={20} color={colors.visit} />
                  <Text variant="small" style={{ flex: 1 }}>
                    Pay through Fliiptech with MoMo or card. If it does not arrive, or is not as described, tell us
                    and we sort it out.
                  </Text>
                </View>
              ) : soldOut ? null : (
                <View style={[styles.protect, styles.direct]}>
                  <Handshake size={20} color={colors.warn} />
                  <Text variant="small" style={{ flex: 1 }}>
                    {"This seller hasn't set up payments yet, so this can't be bought for now. You can still ask them a question."}
                  </Text>
                </View>
              )}

              {!own ? (
                <Pressable onPress={message} style={styles.ask} accessibilityRole="button">
                  <MessageSquare size={16} color={colors.brand} />
                  <Text style={styles.askText}>Ask a question</Text>
                </Pressable>
              ) : null}
            </>
          )}
        </View>
      </ScrollView>

      <BackBar share={data ? { message: data.name, url: `${SITE_URL}/marketplace/${data.id}` } : undefined} />

      {data ? (
        <View style={[styles.cta, { paddingBottom: insets.bottom + space.md }]}>
          <BasketButton size={52} />
          {own ? (
            <Button label="Open your shop" tone="outline" onPress={() => router.push("/seller")} style={{ flex: 1 }} />
          ) : soldOut ? (
            <Button
              label="Get told when it is back"
              tone="outline"
              onPress={() => void waitForStock()}
              style={{ flex: 1 }}
            />
          ) : (
            <>
              <Button
                label={needsOption && !option ? "Choose one" : "Add to basket"}
                busy={adding === "add"}
                disabled={(needsOption && !option) || adding !== null || !data.price || !data.buy_online}
                onPress={() => void put("add")}
                style={{ flex: 1.2, paddingHorizontal: space.sm }}
              />
              <Button
                label="Order now"
                tone="outline"
                icon={<Zap size={16} color={colors.brand} />}
                busy={adding === "order"}
                disabled={(needsOption && !option) || adding !== null || !data.price || !data.buy_online}
                onPress={() => void put("order")}
                style={{ flex: 1, paddingHorizontal: space.sm }}
              />
            </>
          )}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  sheet: {
    marginTop: -24,
    padding: space.lg,
    paddingTop: space.xl,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    backgroundColor: colors.background,
  },
  badge: { alignSelf: "flex-start", paddingHorizontal: space.sm, paddingVertical: 3, borderRadius: radius.pill },
  badgeText: { fontFamily: fonts.bold, fontSize: 12 },
  priceRow: { flexDirection: "row", alignItems: "baseline", gap: space.sm, marginTop: space.sm },
  price: { fontFamily: fonts.extrabold, fontSize: 26, color: colors.brandDeep },
  was: { fontFamily: fonts.medium, fontSize: 16, color: colors.mutedForeground, textDecorationLine: "line-through" },
  seller: {
    marginTop: space.lg,
    flexDirection: "row",
    alignItems: "center",
    gap: space.md,
    padding: space.md,
    borderRadius: radius.lg,
    backgroundColor: colors.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  sellerIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.brandSoft,
  },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: space.sm },
  chip: {
    minHeight: 42,
    paddingHorizontal: space.lg,
    justifyContent: "center",
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    backgroundColor: colors.card,
  },
  chipOn: { backgroundColor: colors.brand, borderColor: colors.brand },
  chipOff: { opacity: 0.4 },
  chipText: { fontFamily: fonts.semibold, fontSize: 14, color: colors.foreground },
  quantityRow: { marginTop: space.xl, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  stepper: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: radius.pill,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
  },
  step: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  count: { minWidth: 28, textAlign: "center", fontFamily: fonts.bold, fontSize: 16, color: colors.foreground },
  student: {
    marginTop: space.md,
    flexDirection: "row",
    gap: space.sm,
    padding: space.md,
    borderRadius: radius.lg,
    backgroundColor: colors.visitBg,
  },
  protect: {
    marginTop: space.xl,
    flexDirection: "row",
    gap: space.md,
    padding: space.md,
    borderRadius: radius.lg,
    backgroundColor: colors.visitBg,
  },
  direct: { backgroundColor: colors.warnBg },
  deposit: {
    marginTop: space.md,
    padding: space.md,
    borderRadius: radius.lg,
    backgroundColor: colors.brandSoft,
    fontFamily: fonts.semibold,
    color: colors.brandDeep,
  },
  ask: {
    marginTop: space.md,
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    minHeight: 44,
    paddingHorizontal: space.xs,
  },
  askText: { fontFamily: fonts.semibold, fontSize: 14, color: colors.brand },
  cta: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: "row",
    gap: space.md,
    paddingHorizontal: space.lg,
    paddingTop: space.md,
    backgroundColor: colors.card,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    ...shadow.floating,
  },
});
