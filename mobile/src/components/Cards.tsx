import { Image } from "expo-image";
import { Clock3, GraduationCap, MapPin, Sparkles, Star } from "lucide-react-native";
import { Pressable, StyleSheet, View } from "react-native";

import { cedis, courseLength } from "@/lib/format";
import { mediaUrl } from "@/lib/media";
import type { CourseCard as Course, ProductCard as Product, ProviderCard as Workshop } from "@/lib/types";
import { colors, fonts, radius, shadow, space } from "@/theme/tokens";

import { Heart } from "./market/Heart";
import { Text } from "./Text";

const LEVELS: Record<string, string> = {
  beginner: "Beginner",
  intermediate: "Some experience",
  advanced: "Advanced",
};

/** A course in a shelf: its still, name, workshop, stars and price. */
export function CourseCard({
  course,
  onPress,
  fill = false,
}: {
  course: Course;
  onPress: () => void;
  /** Full width, for a list, rather than a shelf's fixed width. */
  fill?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.card, fill ? null : { width: 260 }, pressed ? styles.pressed : null]}
      accessibilityRole="button"
      accessibilityLabel={`${course.name}, ${course.price ? cedis(course.price) : "free"}`}
    >
      <View style={styles.media}>
        <Image source={mediaUrl(course.poster)} style={StyleSheet.absoluteFill} contentFit="cover" transition={200} />
        {course.featured ? (
          <View style={styles.featured}>
            <Sparkles size={12} color={colors.brandDeep} />
            <Text style={styles.featuredText}>Featured</Text>
          </View>
        ) : null}
        <View style={styles.length}>
          <Clock3 size={11} color="#fff" />
          <Text style={styles.lengthText}>{courseLength(course.lessons, course.total_seconds)}</Text>
        </View>
      </View>
      <View style={styles.body}>
        {course.trade ? <Text variant="eyebrow">{course.trade.name.toUpperCase()}</Text> : null}
        <Text variant="heading" numberOfLines={2}>
          {course.name}
        </Text>
        <Text variant="small" numberOfLines={1}>
          {course.area}
          {course.level ? ` · ${LEVELS[course.level] ?? course.level}` : ""}
        </Text>
        {course.rating ? (
          <View style={styles.row}>
            <Text style={styles.rating}>{course.rating.toFixed(1)}</Text>
            <Star size={13} color={colors.warn} fill={colors.warn} />
            <Text variant="small">({course.reviews})</Text>
          </View>
        ) : null}
        <View style={styles.row}>
          <Text style={styles.price}>{course.price ? cedis(course.price) : "Free"}</Text>
          {course.full_price ? <Text style={styles.was}>{cedis(course.full_price)}</Text> : null}
        </View>
      </View>
    </Pressable>
  );
}

/** A product in a shelf or grid. */
export function ProductCard({ product, onPress, width }: { product: Product; onPress: () => void; width?: number }) {
  const soldOut = product.availability === "sold_out";
  return (
    <View style={width ? { width } : styles.flexCard}>
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.card, { flex: 1 }, pressed ? styles.pressed : null]}
      accessibilityRole="button"
      accessibilityLabel={product.name}
    >
      <View style={styles.square}>
        <Image source={mediaUrl(product.photo)} style={StyleSheet.absoluteFill} contentFit="cover" transition={200} />
        {soldOut ? (
          <View style={styles.soldOut}>
            <Text style={styles.soldOutText}>Sold out</Text>
          </View>
        ) : product.condition === "used" ? (
          <View style={[styles.featured, { backgroundColor: colors.warnBg }]}>
            <Text style={[styles.featuredText, { color: colors.warn }]}>Second-hand</Text>
          </View>
        ) : product.sponsored ? (
          <View style={styles.featured}>
            <Text style={styles.featuredText}>Sponsored</Text>
          </View>
        ) : null}
      </View>
      <View style={styles.body}>
        <Text variant="label" numberOfLines={2}>
          {product.name}
        </Text>
        <Text variant="small" numberOfLines={1}>
          {product.seller.business_name}
        </Text>
        {product.few_left ? <Text style={styles.fewLeft}>Only {product.few_left} left</Text> : null}
        {product.seller.workshop ? (
          <View style={styles.trainer}>
            <GraduationCap size={12} color={colors.brand} />
            <Text style={styles.trainerText}>Trainer</Text>
          </View>
        ) : null}
        <View style={styles.row}>
          <Text style={styles.price}>{product.price ? cedis(product.price) : "Ask for price"}</Text>
          {product.was_price ? <Text style={styles.was}>{cedis(product.was_price)}</Text> : null}
        </View>
      </View>
    </Pressable>
      {/* Beside the card, not inside it: a button inside a button is not
          allowed, and a tap on the heart must not open the product. */}
      <View style={styles.heart}>
        <Heart productId={product.id} size={32} />
      </View>
    </View>
  );
}

/** A workshop in a list: photo beside its name, place, fee and next intake. */
export function WorkshopRow({ workshop, onPress }: { workshop: Workshop; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.rowCard, pressed ? styles.pressed : null]}
      accessibilityRole="button"
      accessibilityLabel={`${workshop.name}, ${workshop.area}`}
    >
      <View style={styles.thumb}>
        <Image source={mediaUrl(workshop.primary_photo)} style={StyleSheet.absoluteFill} contentFit="cover" transition={200} />
      </View>
      <View style={styles.rowBody}>
        {workshop.trade ? <Text variant="eyebrow">{workshop.trade.name.toUpperCase()}</Text> : null}
        <Text variant="heading" numberOfLines={2}>
          {workshop.name}
        </Text>
        <View style={styles.row}>
          <MapPin size={13} color={colors.mutedForeground} />
          <Text variant="small" numberOfLines={1}>
            {workshop.area}, {workshop.region}
          </Text>
        </View>
        <View style={styles.row}>
          <Text style={styles.price}>
            {workshop.lowest_fee ? `From ${cedis(workshop.lowest_fee)}` : "Fees on request"}
          </Text>
          {workshop.shortest_duration_weeks ? (
            <Text variant="small"> · {workshop.shortest_duration_weeks} weeks</Text>
          ) : null}
        </View>
        {workshop.next_intake ? (
          <Text variant="small" style={styles.intake}>
            Next intake {new Date(workshop.next_intake).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  heart: { position: "absolute", top: 8, right: 8, zIndex: 2 },
  fewLeft: { fontFamily: fonts.bold, fontSize: 11, color: colors.warn },
  trainer: { flexDirection: "row", alignItems: "center", gap: 4 },
  trainerText: { fontFamily: fonts.semibold, fontSize: 11, color: colors.brand },
  card: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    overflow: "hidden",
    ...shadow.card,
  },
  flexCard: { flex: 1 },
  pressed: { opacity: 0.85, transform: [{ scale: 0.985 }] },
  media: { aspectRatio: 16 / 9, backgroundColor: colors.brandDeep },
  square: { aspectRatio: 1, backgroundColor: colors.muted },
  body: { padding: space.md, gap: 4 },
  row: { flexDirection: "row", alignItems: "center", gap: 4 },
  rating: { fontFamily: fonts.bold, fontSize: 13, color: colors.warn },
  price: { fontFamily: fonts.extrabold, fontSize: 16, color: colors.brandDeep },
  was: {
    fontFamily: fonts.medium,
    fontSize: 13,
    color: colors.mutedForeground,
    textDecorationLine: "line-through",
  },
  featured: {
    position: "absolute",
    top: 8,
    left: 8,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: radius.pill,
    backgroundColor: colors.sand,
  },
  featuredText: { fontFamily: fonts.extrabold, fontSize: 11, color: colors.brandDeep },
  length: {
    position: "absolute",
    left: 8,
    bottom: 8,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
    backgroundColor: "rgba(0,0,0,0.6)",
  },
  lengthText: { fontFamily: fonts.bold, fontSize: 11, color: "#fff" },
  soldOut: { ...StyleSheet.absoluteFill, backgroundColor: "rgba(23,20,38,0.45)", alignItems: "center", justifyContent: "center" },
  soldOutText: { fontFamily: fonts.extrabold, color: "#fff", fontSize: 13 },
  rowCard: {
    flexDirection: "row",
    gap: space.md,
    padding: space.md,
    marginHorizontal: space.lg,
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    ...shadow.card,
  },
  thumb: { width: 96, height: 96, borderRadius: radius.md, overflow: "hidden", backgroundColor: colors.muted },
  rowBody: { flex: 1, gap: 3 },
  intake: { color: colors.visit, fontFamily: fonts.semibold },
});
