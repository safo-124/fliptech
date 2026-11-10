import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Image } from "expo-image";
import { router, useLocalSearchParams } from "expo-router";
import { BadgeCheck, Bell, BellOff, GraduationCap, MapPin, MessageSquare, Star, Truck } from "lucide-react-native";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { BackBar } from "@/components/BackBar";
import { ProductCard } from "@/components/Cards";
import { Button } from "@/components/Form";
import { BundleCard } from "@/components/market/BundleCard";
import { ErrorState, Skeleton } from "@/components/States";
import { Text } from "@/components/Text";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { SITE_URL } from "@/lib/config";
import { cedis, shortDate } from "@/lib/format";
import { photoUrl } from "@/lib/media";
import { colors, fonts, radius, shadow, space } from "@/theme/tokens";

/**
 * A shop: banner (Shop plan), who they are, follow, message, their bundles,
 * everything they sell, and buyers' reviews.
 */
export default function ShopScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const auth = useAuth();
  const client = useQueryClient();
  const shop = useQuery({ queryKey: ["shop", id], queryFn: () => api.shop(id) });
  const bundles = useQuery({ queryKey: ["shop-bundles", id], queryFn: () => api.shopBundles(id) });
  const follow = useQuery({
    queryKey: ["follow", id, auth.signedIn],
    queryFn: () => api.followState(Number(id)),
  });
  const toggle = useMutation({
    mutationFn: (on: boolean) => api.follow(Number(id), on),
    onSuccess: (state) => client.setQueryData(["follow", id, auth.signedIn], state),
  });

  if (shop.isError) {
    return (
      <View style={[styles.screen, { paddingTop: insets.top + 80 }]}>
        <BackBar />
        <ErrorState message="This shop did not load." onRetry={() => void shop.refetch()} />
      </View>
    );
  }

  const data = shop.data;
  const seller = data?.seller;
  const offered = (bundles.data?.results ?? []).filter((bundle) => bundle.buy_online);
  const rows = data
    ? Array.from({ length: Math.ceil(data.products.length / 2) }, (_, n) => data.products.slice(n * 2, n * 2 + 2))
    : [];

  function onFollow() {
    if (!auth.signedIn) {
      router.push({ pathname: "/sign-in", params: { why: "to follow this shop" } });
      return;
    }
    toggle.mutate(!follow.data?.following);
  }

  function onMessage() {
    if (!seller) return;
    if (!auth.signedIn) {
      router.push({ pathname: "/sign-in", params: { why: "to message sellers" } });
      return;
    }
    router.push({ pathname: "/chats/new", params: { seller: String(seller.id), name: seller.business_name } });
  }

  return (
    <View style={styles.screen}>
      <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + space.xxl }}>
        <View style={[styles.banner, { height: insets.top + 150 }]}>
          {data?.banner ? (
            <Image source={photoUrl(data.banner, "full")} style={StyleSheet.absoluteFill} contentFit="cover" />
          ) : null}
        </View>
        <View style={styles.sheet}>
          {!seller ? (
            <View style={{ gap: space.md }}>
              <Skeleton style={{ height: 28, width: "70%" }} />
              <Skeleton style={{ height: 18, width: "40%" }} />
              <Skeleton style={{ height: 200 }} />
            </View>
          ) : (
            <>
              <View style={styles.avatar}>
                <Text style={styles.initial}>{seller.business_name.slice(0, 1).toUpperCase()}</Text>
              </View>
              <Text variant="display" style={{ marginTop: space.sm }}>
                {seller.business_name}
              </Text>
              <View style={styles.meta}>
                <MapPin size={14} color={colors.mutedForeground} />
                <Text variant="small">
                  {seller.area}, {seller.region}
                </Text>
                {seller.rating ? (
                  <>
                    <Star size={14} color="#f5b301" fill="#f5b301" />
                    <Text variant="label">
                      {seller.rating.average.toFixed(1)} ({seller.rating.count})
                    </Text>
                  </>
                ) : null}
              </View>
              <View style={styles.badges}>
                {seller.workshop ? (
                  <Badge icon={<GraduationCap size={13} color={colors.brand} />} label="Training workshop" tone="brand" />
                ) : null}
                {seller.verified ? (
                  <Badge icon={<BadgeCheck size={13} color={colors.visit} />} label="Verified maker" tone="visit" />
                ) : null}
                {seller.delivery_fee !== null ? (
                  <Badge
                    icon={<Truck size={13} color={colors.brand} />}
                    label={Number(seller.delivery_fee) ? `Delivers · ${cedis(seller.delivery_fee)}` : "Free delivery"}
                    tone="brand"
                  />
                ) : null}
              </View>

              <View style={styles.actions}>
                <Button
                  label={follow.data?.following ? "Following" : "Follow"}
                  tone={follow.data?.following ? "soft" : "outline"}
                  busy={toggle.isPending}
                  icon={
                    follow.data?.following ? (
                      <BellOff size={16} color={colors.brand} />
                    ) : (
                      <Bell size={16} color={colors.brand} />
                    )
                  }
                  onPress={onFollow}
                  style={{ flex: 1 }}
                />
                <Button
                  label="Message"
                  icon={<MessageSquare size={16} color="#ffffff" />}
                  onPress={onMessage}
                  style={{ flex: 1 }}
                />
              </View>
              {follow.data?.followers ? (
                <Text variant="small" style={{ marginTop: space.sm }}>
                  {follow.data.followers} {follow.data.followers === 1 ? "follower" : "followers"}
                </Text>
              ) : null}

              {seller.away_until ? (
                <Text style={styles.away}>
                  Away until {shortDate(seller.away_until)}. {seller.away_note}
                </Text>
              ) : null}
              {seller.student_discount && seller.workshop ? (
                <Text style={styles.student}>
                  Trainees of {seller.workshop.name} get {seller.student_discount}% off. Sign in with the phone you
                  trained with.
                </Text>
              ) : null}
              {seller.about ? <Text style={styles.about}>{seller.about}</Text> : null}
              {seller.workshop ? (
                <Pressable
                  onPress={() => router.push(`/workshop/${seller.workshop!.area_slug}/${seller.workshop!.slug}`)}
                  style={styles.workshop}
                  accessibilityRole="link"
                >
                  <GraduationCap size={20} color={colors.visit} />
                  <Text style={{ flex: 1, color: colors.visit, fontFamily: fonts.semibold }}>
                    Learn the trade at {seller.workshop.name}
                  </Text>
                </Pressable>
              ) : null}
            </>
          )}
        </View>

        {offered.length ? (
          <View style={styles.section}>
            <Text variant="title">Learn and buy</Text>
            <Text variant="small">The course and the tools for it, together for less.</Text>
            <View style={{ gap: space.md, marginTop: space.md }}>
              {offered.map((bundle) => (
                <BundleCard key={bundle.id} bundle={bundle} />
              ))}
            </View>
          </View>
        ) : null}

        {data ? (
          <View style={styles.section}>
            <Text variant="title">Products</Text>
            {data.products.length ? (
              <View style={{ gap: space.md, marginTop: space.md }}>
                {rows.map((pair) => (
                  <View key={pair[0].id} style={styles.row}>
                    {pair.map((product) => (
                      <ProductCard key={product.id} product={product} onPress={() => router.push(`/product/${product.id}`)} />
                    ))}
                    {pair.length === 1 ? <View style={{ flex: 1 }} /> : null}
                  </View>
                ))}
              </View>
            ) : (
              <Text variant="small" style={{ marginTop: space.sm }}>
                Nothing on show right now.
              </Text>
            )}
          </View>
        ) : null}

        {data?.reviews.length ? (
          <View style={styles.section}>
            <Text variant="title">Reviews</Text>
            <View style={{ gap: space.md, marginTop: space.md }}>
              {data.reviews.map((review) => (
                <View key={review.id} style={styles.review}>
                  <View style={{ flexDirection: "row", gap: 2 }}>
                    {Array.from({ length: 5 }, (_, n) => (
                      <Star key={n} size={14} color="#f5b301" fill={n < review.rating ? "#f5b301" : "transparent"} />
                    ))}
                  </View>
                  {review.comment ? <Text style={{ marginTop: 4 }}>{review.comment}</Text> : null}
                  <Text variant="small" style={{ marginTop: 4 }}>
                    {review.buyer_name || "A buyer"}
                    {review.bought ? " · Bought here" : ""} · {review.product_name}
                  </Text>
                </View>
              ))}
            </View>
          </View>
        ) : null}
      </ScrollView>
      <BackBar
        share={seller ? { message: `${seller.business_name} on Fliiptech:`, url: `${SITE_URL}/marketplace/seller/${seller.id}` } : undefined}
      />
    </View>
  );
}

function Badge({ icon, label, tone }: { icon: React.ReactNode; label: string; tone: "brand" | "visit" }) {
  return (
    <View style={[styles.badge, { backgroundColor: tone === "visit" ? colors.visitBg : colors.brandSoft }]}>
      {icon}
      <Text style={[styles.badgeText, { color: tone === "visit" ? colors.visit : colors.brand }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  banner: { backgroundColor: colors.brandDeep },
  sheet: {
    marginTop: -24,
    padding: space.lg,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    backgroundColor: colors.background,
  },
  avatar: {
    marginTop: -48,
    width: 72,
    height: 72,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.brand,
    borderWidth: 4,
    borderColor: colors.background,
    ...shadow.card,
  },
  initial: { fontFamily: fonts.extrabold, fontSize: 28, color: "#ffffff" },
  meta: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 4, flexWrap: "wrap" },
  badges: { flexDirection: "row", flexWrap: "wrap", gap: space.sm, marginTop: space.md },
  badge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: space.sm,
    paddingVertical: 4,
    borderRadius: radius.pill,
  },
  badgeText: { fontFamily: fonts.semibold, fontSize: 12 },
  actions: { flexDirection: "row", gap: space.md, marginTop: space.lg },
  away: {
    marginTop: space.md,
    padding: space.md,
    borderRadius: radius.md,
    backgroundColor: colors.warnBg,
    color: colors.warn,
    fontFamily: fonts.medium,
  },
  student: {
    marginTop: space.md,
    padding: space.md,
    borderRadius: radius.md,
    backgroundColor: colors.visitBg,
    color: colors.visit,
    fontFamily: fonts.medium,
  },
  about: { marginTop: space.md, color: colors.mutedForeground, lineHeight: 22 },
  workshop: {
    marginTop: space.md,
    flexDirection: "row",
    alignItems: "center",
    gap: space.sm,
    padding: space.md,
    borderRadius: radius.md,
    backgroundColor: colors.visitBg,
  },
  section: { paddingHorizontal: space.lg, marginTop: space.xl },
  row: { flexDirection: "row", gap: space.md },
  review: {
    padding: space.md,
    borderRadius: radius.lg,
    backgroundColor: colors.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
});
