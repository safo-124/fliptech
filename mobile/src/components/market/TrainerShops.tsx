import { Image } from "expo-image";
import { GraduationCap } from "lucide-react-native";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";

import { Text } from "@/components/Text";
import { photoUrl } from "@/lib/media";
import type { TrainerShop } from "@/lib/types";
import { colors, fonts, radius, shadow, space } from "@/theme/tokens";

/** "Made by people who teach it": training workshops that also sell. */
export function TrainerShops({ shops, onPick }: { shops: TrainerShop[]; onPick: (shop: TrainerShop) => void }) {
  if (!shops.length) return null;
  return (
    <View style={{ gap: space.sm }}>
      <View style={{ paddingHorizontal: space.lg }}>
        <Text variant="heading">Made by people who teach it</Text>
        <Text variant="small">Training workshops on Fliiptech. Buy their work, then learn the trade from them.</Text>
      </View>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: space.lg, gap: space.md, paddingVertical: 4 }}
      >
        {shops.map((shop) => (
          <Pressable
            key={shop.id}
            onPress={() => onPick(shop)}
            accessibilityRole="button"
            accessibilityLabel={`${shop.business_name}, ${shop.product_count} products`}
            style={({ pressed }) => [styles.card, pressed ? { opacity: 0.85 } : null]}
          >
            <View style={styles.photo}>
              {shop.photo ? (
                <Image source={photoUrl(shop.photo)} style={StyleSheet.absoluteFill} contentFit="cover" />
              ) : null}
              <View style={styles.badge}>
                <GraduationCap size={11} color="#ffffff" />
                <Text style={styles.badgeText}>TRAINER</Text>
              </View>
            </View>
            <View style={{ padding: space.sm }}>
              <Text variant="label" numberOfLines={1}>
                {shop.business_name}
              </Text>
              <Text variant="small" numberOfLines={1}>
                {shop.product_count} {shop.product_count === 1 ? "product" : "products"}
              </Text>
            </View>
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    width: 140,
    borderRadius: radius.lg,
    overflow: "hidden",
    backgroundColor: colors.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    ...shadow.card,
  },
  photo: { height: 120, backgroundColor: colors.muted },
  badge: {
    position: "absolute",
    top: 6,
    left: 6,
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: radius.pill,
    backgroundColor: colors.brand,
  },
  badgeText: { fontFamily: fonts.extrabold, fontSize: 9, letterSpacing: 0.6, color: "#ffffff" },
});
