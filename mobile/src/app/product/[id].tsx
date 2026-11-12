import { useQuery } from "@tanstack/react-query";
import { router, useLocalSearchParams } from "expo-router";
import { GraduationCap, Info, MessageSquare, Minus, Plus, ShieldCheck, ShoppingBag, Store } from "lucide-react-native";
import { useState } from "react";
import { Alert, Pressable, ScrollView, StyleSheet, View } from "react-native";
import Animated, { useAnimatedStyle, useSharedValue, withSequence, withSpring } from "react-native-reanimated";
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
import { MAX_QUANTITY, useBag } from "@/lib/bag";
import { SITE_URL } from "@/lib/config";
import { cedis } from "@/lib/format";
import { colors, fonts, radius, shadow, space } from "@/theme/tokens";

const AVAILABILITY = {
  available: { label: "In stock", color: colors.visit, bg: colors.visitBg },
  made_to_order: { label: "Made to order", color: colors.warn, bg: colors.warnBg },
  sold_out: { label: "Sold out", color: colors.mutedForeground, bg: colors.muted },
} as const;

/** A product: photos, options, how many, then into the bag. */
export default function ProductScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const bag = useBag();
  const auth = useAuth();
  const product = useQuery({ queryKey: ["product", id], queryFn: () => api.product(id) });
  const [optionId, setOptionId] = useState<number | null>(null);
  const [quantity, setQuantity] = useState(1);
  const bump = useSharedValue(1);
  const bumped = useAnimatedStyle(() => ({ transform: [{ scale: bump.get() }] }));

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

  function add() {
    if (!data) return;
    bag.add({
      product: data.id,
      option: option?.id ?? null,
      optionLabel: option?.label ?? "",
      quantity,
      name: data.name,
      photo: data.photo,
      price,
      seller: { id: data.seller.id, business_name: data.seller.business_name },
    });
    bump.set(withSequence(withSpring(1.25), withSpring(1)));
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

              <Button
                label={`Message ${data.seller.business_name}`}
                tone="outline"
                icon={<MessageSquare size={16} color={colors.brand} />}
                onPress={message}
                style={{ marginTop: space.md }}
              />

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

              {data.buy_online ? (
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
                      onPress={() => setQuantity((n) => Math.min(MAX_QUANTITY, n + 1))}
                      style={styles.step}
                      accessibilityRole="button"
                      accessibilityLabel="One more"
                    >
                      <Plus size={18} color={colors.foreground} />
                    </Pressable>
                  </View>
                </View>
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
              {data.buy_online ? (
                <View style={styles.protect}>
                  <ShieldCheck size={20} color={colors.visit} />
                  <Text variant="small" style={{ flex: 1 }}>
                    Pay through Fliiptech with MoMo or card. If it does not arrive, or is not as described, tell us
                    and we sort it out.
                  </Text>
                </View>
              ) : (
                <View style={[styles.protect, styles.direct]}>
                  <Info size={20} color={colors.warn} />
                  <Text variant="small" style={{ flex: 1 }}>
                    You pay the maker directly. Fliiptech does not handle the money and cannot refund it, so agree
                    the price and the handover with them before you pay.
                  </Text>
                </View>
              )}
            </>
          )}
        </View>
      </ScrollView>

      <BackBar share={data ? { message: data.name, url: `${SITE_URL}/marketplace/${data.id}` } : undefined} />

      {data ? (
        <View style={[styles.cta, { paddingBottom: insets.bottom + space.md }]}>
          <Pressable
            onPress={() => router.push("/bag")}
            style={styles.bagButton}
            accessibilityRole="button"
            accessibilityLabel={`Bag, ${bag.count} things`}
          >
            <Animated.View style={bumped}>
              <ShoppingBag size={22} color={colors.brand} />
            </Animated.View>
            {bag.count ? (
              <View style={styles.dot}>
                <Text style={styles.dotText}>{String(bag.count)}</Text>
              </View>
            ) : null}
          </Pressable>
          {data.buy_online ? (
            <Button
              label={needsOption && !option ? "Choose an option" : `Add to bag · ${cedis(Number(price ?? 0) * quantity)}`}
              disabled={needsOption && !option}
              onPress={add}
              style={{ flex: 1 }}
            />
          ) : (
            <Button
              label={data.availability === "sold_out" ? "Get told when it is back" : "Ask the seller"}
              tone="outline"
              onPress={data.availability === "sold_out" ? () => void waitForStock() : message}
              style={{ flex: 1 }}
            />
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
  bagButton: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.brandSoft,
  },
  dot: {
    position: "absolute",
    top: 4,
    right: 4,
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
