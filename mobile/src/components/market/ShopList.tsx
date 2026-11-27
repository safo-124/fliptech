import { Image } from "expo-image";
import { router } from "expo-router";
import { GraduationCap, Star, Store } from "lucide-react-native";
import { Pressable, StyleSheet, View } from "react-native";

import { EmptyState } from "@/components/States";
import { Text } from "@/components/Text";
import { photoUrl } from "@/lib/media";
import type { ShopListItem } from "@/lib/types";
import { colors, fonts, radius, space } from "@/theme/tokens";

/**
 * Every shop, for the Shop tab's Shops view: trainers' shops first (the
 * server's order), each with a strip of its product photos. A tap opens the
 * shop, where everything it sells is listed.
 */
export function ShopList({ shops }: { shops: ShopListItem[] }) {
  if (!shops.length) return <EmptyState title="No shops yet" body="Sellers are opening their first shops." />;
  return (
    <View style={{ gap: space.md, paddingHorizontal: space.lg }}>
      {shops.map((shop) => {
        const photos = shop.photos.length ? shop.photos : shop.photo ? [shop.photo] : [];
        return (
          <Pressable
            key={shop.id}
            onPress={() => router.push(`/shop/${shop.id}`)}
            accessibilityRole="button"
            accessibilityLabel={`${shop.business_name}, ${shop.product_count} ${shop.product_count === 1 ? "item" : "items"}`}
            style={({ pressed }) => [styles.card, pressed ? { opacity: 0.85 } : null]}
          >
            <View style={styles.strip}>
              {photos.length ? (
                photos.slice(0, 4).map((photo) => (
                  <Image key={photo} source={photoUrl(photo)} style={styles.photo} contentFit="cover" />
                ))
              ) : (
                <View style={[styles.photo, styles.empty]}>
                  <Store size={22} color={colors.mutedForeground} />
                </View>
              )}
            </View>
            <View style={styles.body}>
              <View style={styles.nameRow}>
                <Text variant="heading" numberOfLines={1} style={{ flexShrink: 1 }}>
                  {shop.business_name}
                </Text>
                {shop.is_trainer ? (
                  <View style={styles.badge}>
                    <GraduationCap size={11} color="#ffffff" />
                    <Text style={styles.badgeText}>TRAINER</Text>
                  </View>
                ) : null}
              </View>
              <View style={styles.nameRow}>
                <Text variant="small" numberOfLines={1}>
                  {shop.area} · {shop.product_count} {shop.product_count === 1 ? "item" : "items"}
                </Text>
                {shop.rating ? (
                  <View style={styles.rating}>
                    <Star size={12} color={colors.warn} fill={colors.warn} />
                    <Text variant="small">{shop.rating.average.toFixed(1)}</Text>
                  </View>
                ) : null}
              </View>
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    backgroundColor: colors.card,
    overflow: "hidden",
  },
  strip: { flexDirection: "row", gap: 2, height: 96, backgroundColor: colors.muted },
  photo: { flex: 1, height: 96 },
  empty: { alignItems: "center", justifyContent: "center" },
  body: { padding: space.md, gap: 2 },
  nameRow: { flexDirection: "row", alignItems: "center", gap: space.sm },
  badge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: radius.pill,
    backgroundColor: colors.brand,
  },
  badgeText: { fontFamily: fonts.bold, fontSize: 9, color: "#ffffff", letterSpacing: 0.5 },
  rating: { flexDirection: "row", alignItems: "center", gap: 3 },
});
