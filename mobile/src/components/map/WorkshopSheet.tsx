import { Image } from "expo-image";
import { CalendarDays, MapPin, Navigation, X } from "lucide-react-native";
import { Pressable, StyleSheet, View } from "react-native";
import Animated, { FadeInDown, FadeOutDown } from "react-native-reanimated";

import { Text } from "@/components/Text";
import { cedis } from "@/lib/format";
import { photoUrl } from "@/lib/media";
import type { ProviderCard } from "@/lib/types";
import { tradeHex } from "@/theme/trades";
import { colors, fonts, radius, shadow, space } from "@/theme/tokens";

/** The workshop behind a tapped pin, sliding up from the foot of the map. */
export function WorkshopSheet({
  workshop,
  bottom,
  onClose,
  onView,
  onDirections,
}: {
  workshop: ProviderCard;
  bottom: number;
  onClose: () => void;
  /** The workshop's page: fees, intakes and enquiring. */
  onView: () => void;
  /** The phone's own maps app, for the way there. */
  onDirections: () => void;
}) {
  const trade = tradeHex(workshop.trade?.colour);
  return (
    <Animated.View
      entering={FadeInDown.duration(220)}
      exiting={FadeOutDown.duration(160)}
      style={[styles.card, { bottom }]}
    >
      <Pressable onPress={onView} style={styles.top} accessibilityRole="button" accessibilityLabel={workshop.name}>
        <View style={styles.photo}>
          <Image source={photoUrl(workshop.primary_photo)} style={StyleSheet.absoluteFill} contentFit="cover" />
        </View>
        <View style={styles.body}>
          {workshop.trade ? (
            <View style={[styles.trade, { backgroundColor: trade.bg }]}>
              <Text style={[styles.tradeText, { color: trade.fg }]}>{workshop.trade.name}</Text>
            </View>
          ) : null}
          <Text variant="heading" numberOfLines={2}>
            {workshop.name}
          </Text>
          <View style={styles.row}>
            <MapPin size={13} color={colors.mutedForeground} />
            <Text variant="small" numberOfLines={1}>
              {workshop.area}, {workshop.region}
            </Text>
          </View>
          <Text style={styles.fee}>
            {workshop.lowest_fee ? `From ${cedis(workshop.lowest_fee)}` : "Fees on request"}
            {workshop.shortest_duration_weeks ? (
              <Text variant="small">{`  ·  ${workshop.shortest_duration_weeks} weeks`}</Text>
            ) : null}
          </Text>
          {workshop.next_intake ? (
            <View style={styles.row}>
              <CalendarDays size={13} color={colors.visit} />
              <Text variant="small" style={styles.intake}>
                Next intake{" "}
                {new Date(workshop.next_intake).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}
              </Text>
            </View>
          ) : null}
        </View>
      </Pressable>
      <Pressable onPress={onClose} hitSlop={10} style={styles.close} accessibilityRole="button" accessibilityLabel="Close">
        <X size={18} color={colors.mutedForeground} />
      </Pressable>
      <View style={styles.actions}>
        <Pressable onPress={onDirections} style={[styles.button, styles.secondary]} accessibilityRole="button">
          <Navigation size={16} color={colors.brand} />
          <Text style={styles.secondaryText}>Directions</Text>
        </Pressable>
        <Pressable onPress={onView} style={[styles.button, styles.primary]} accessibilityRole="button">
          <Text style={styles.primaryText}>See fees & enquire</Text>
        </Pressable>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  card: {
    position: "absolute",
    left: space.lg,
    right: space.lg,
    padding: space.md,
    borderRadius: radius.xl,
    backgroundColor: colors.card,
    ...shadow.floating,
  },
  top: { flexDirection: "row", gap: space.md, paddingRight: 28 },
  photo: { width: 92, height: 92, borderRadius: radius.md, overflow: "hidden", backgroundColor: colors.muted },
  body: { flex: 1, gap: 3 },
  trade: { alignSelf: "flex-start", paddingHorizontal: 8, paddingVertical: 2, borderRadius: radius.pill },
  tradeText: { fontFamily: fonts.bold, fontSize: 11 },
  row: { flexDirection: "row", alignItems: "center", gap: 4 },
  fee: { fontFamily: fonts.extrabold, fontSize: 15, color: colors.brandDeep },
  intake: { color: colors.visit, fontFamily: fonts.semibold },
  close: { position: "absolute", top: space.md, right: space.md },
  actions: { flexDirection: "row", gap: space.sm, marginTop: space.md },
  button: {
    flex: 1,
    minHeight: 46,
    flexDirection: "row",
    gap: 6,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
  },
  secondary: { backgroundColor: colors.brandSoft },
  secondaryText: { fontFamily: fonts.bold, fontSize: 14, color: colors.brand },
  primary: { backgroundColor: colors.brand },
  primaryText: { fontFamily: fonts.bold, fontSize: 14, color: "#ffffff" },
});
