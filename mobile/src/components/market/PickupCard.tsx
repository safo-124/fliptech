import { router } from "expo-router";
import { Navigation, Store } from "lucide-react-native";
import { Linking, Platform, Pressable, StyleSheet, View } from "react-native";

import { Text } from "@/components/Text";
import type { PickupPoint } from "@/lib/types";
import { colors, fonts, radius, space } from "@/theme/tokens";

/** Collect from the workshop: its address, directions, and the phone's maps. */
export function PickupCard({ pickup }: { pickup: PickupPoint }) {
  function directions() {
    if (pickup.lat === null || pickup.lng === null) return;
    const label = encodeURIComponent(pickup.name);
    const native =
      Platform.OS === "ios"
        ? `maps:0,0?q=${label}@${pickup.lat},${pickup.lng}`
        : `geo:${pickup.lat},${pickup.lng}?q=${pickup.lat},${pickup.lng}(${label})`;
    Linking.openURL(native).catch(() =>
      Linking.openURL(`https://www.openstreetmap.org/?mlat=${pickup.lat}&mlon=${pickup.lng}#map=17/${pickup.lat}/${pickup.lng}`),
    );
  }
  const [, area, slug] = pickup.workshop_path.split("/");
  return (
    <View style={styles.card}>
      <View style={styles.head}>
        <Store size={18} color={colors.brand} />
        <Text variant="label">Collect from the workshop</Text>
      </View>
      <Pressable onPress={() => router.push(`/workshop/${area}/${slug}`)} accessibilityRole="link">
        <Text style={styles.name}>{pickup.name}</Text>
      </Pressable>
      <Text variant="small">
        {pickup.address ? `${pickup.address}, ` : ""}
        {pickup.area}
      </Text>
      {pickup.directions ? <Text variant="small">{pickup.directions}</Text> : null}
      {pickup.lat !== null ? (
        <Pressable onPress={directions} style={styles.go} accessibilityRole="button">
          <Navigation size={16} color={colors.brand} />
          <Text style={styles.goText}>Directions</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    marginTop: space.lg,
    gap: 4,
    padding: space.md,
    borderRadius: radius.lg,
    backgroundColor: colors.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  head: { flexDirection: "row", alignItems: "center", gap: space.sm, marginBottom: 2 },
  name: { fontFamily: fonts.semibold, fontSize: 15, color: colors.brand },
  go: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: space.sm, minHeight: 36 },
  goText: { fontFamily: fonts.semibold, fontSize: 14, color: colors.brand },
});
