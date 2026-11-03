import { Image } from "expo-image";
import { router } from "expo-router";
import { GraduationCap, PackageCheck } from "lucide-react-native";
import { Pressable, StyleSheet, View } from "react-native";

import { Text } from "@/components/Text";
import { cedis } from "@/lib/format";
import { mediaUrl } from "@/lib/media";
import type { Bundle } from "@/lib/types";
import { colors, fonts, radius, shadow, space } from "@/theme/tokens";

/** A learn-and-buy bundle: the course, the kit, the price and the saving. */
export function BundleCard({ bundle, onPress }: { bundle: Bundle; onPress?: () => void }) {
  return (
    <Pressable
      onPress={onPress ?? (() => router.push(`/bundle/${bundle.id}`))}
      accessibilityRole="button"
      accessibilityLabel={`${bundle.title}, ${cedis(bundle.price)}`}
      style={({ pressed }) => [styles.card, pressed ? { opacity: 0.85 } : null]}
    >
      <View style={styles.top}>
        <PackageCheck size={20} color={colors.brand} />
        <Text variant="heading" style={{ flex: 1 }} numberOfLines={2}>
          {bundle.title}
        </Text>
        {bundle.saving && Number(bundle.saving) > 0 ? (
          <View style={styles.save}>
            <Text style={styles.saveText}>Save {cedis(bundle.saving)}</Text>
          </View>
        ) : null}
      </View>
      {bundle.course ? (
        <View style={styles.line}>
          <View style={styles.thumb}>
            <GraduationCap size={18} color={colors.brand} />
          </View>
          <Text style={{ flex: 1 }} numberOfLines={1}>
            Online course: {bundle.course.name}
          </Text>
        </View>
      ) : null}
      {bundle.items.map((item) => (
        <View key={item.product.id} style={styles.line}>
          <View style={styles.thumb}>
            {item.product.photo ? (
              <Image source={mediaUrl(item.product.photo)} style={StyleSheet.absoluteFill} contentFit="cover" />
            ) : null}
          </View>
          <Text style={{ flex: 1 }} numberOfLines={1}>
            {item.quantity > 1 ? `${item.quantity} × ` : ""}
            {item.product.name}
          </Text>
        </View>
      ))}
      <View style={styles.foot}>
        <Text style={styles.price}>{cedis(bundle.price)}</Text>
        {bundle.full_price && bundle.full_price !== bundle.price ? (
          <Text style={styles.was}>{cedis(bundle.full_price)}</Text>
        ) : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: space.sm,
    padding: space.lg,
    borderRadius: radius.lg,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.brandSoft,
    ...shadow.card,
  },
  top: { flexDirection: "row", alignItems: "center", gap: space.sm },
  save: { paddingHorizontal: space.sm, paddingVertical: 3, borderRadius: radius.pill, backgroundColor: colors.visitBg },
  saveText: { fontFamily: fonts.bold, fontSize: 12, color: colors.visit },
  line: { flexDirection: "row", alignItems: "center", gap: space.sm },
  thumb: {
    width: 36,
    height: 36,
    borderRadius: 8,
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.brandSoft,
  },
  foot: { flexDirection: "row", alignItems: "baseline", gap: space.sm, marginTop: 4 },
  price: { fontFamily: fonts.extrabold, fontSize: 22, color: colors.brandDeep },
  was: { fontFamily: fonts.medium, fontSize: 14, color: colors.mutedForeground, textDecorationLine: "line-through" },
});
