import { useQuery } from "@tanstack/react-query";
import { router } from "expo-router";
import { ChevronRight, GraduationCap, PlayCircle, Search, ShoppingBag } from "lucide-react-native";
import { Pressable, StyleSheet, View } from "react-native";

import { CourseCard, ProductCard, WorkshopRow } from "@/components/Cards";
import { Hero } from "@/components/Hero";
import { Screen } from "@/components/Screen";
import { Section, Shelf } from "@/components/Section";
import { EmptyState, ErrorState, Skeleton } from "@/components/States";
import { Text } from "@/components/Text";
import { api } from "@/lib/api";
import type { UpcomingIntake } from "@/lib/types";
import { colors, fonts, radius, space } from "@/theme/tokens";

const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

/**
 * Home, laid out like the website's: a calm headline and search, the three
 * parts of the app as tiles, then what is starting soon, courses, workshops
 * and products, and how it works.
 */
export default function HomeScreen() {
  const courses = useQuery({ queryKey: ["courses", "home"], queryFn: () => api.courses() });
  const workshops = useQuery({ queryKey: ["providers", "home"], queryFn: () => api.providers() });
  const products = useQuery({ queryKey: ["products", "home"], queryFn: () => api.products() });
  const intakes = useQuery({ queryKey: ["intakes", "upcoming"], queryFn: () => api.upcomingIntakes(6) });
  const refreshing = courses.isRefetching || workshops.isRefetching || products.isRefetching;

  return (
    <Screen
      edgeToEdgeTop
      refreshing={refreshing}
      onRefresh={() => {
        void courses.refetch();
        void workshops.refetch();
        void products.refetch();
        void intakes.refetch();
      }}
    >
      <Hero
        eyebrow="Skills training across Ghana"
        title="Turn your skills into opportunities."
        body="Hands-on training in real workshops, lessons from the people who teach them, and tools from the makers."
        onMap={() => router.push("/map")}
      />

      {/* Search everything, as you type, on its own screen. */}
      <Pressable
        onPress={() => router.push("/search")}
        accessibilityRole="search"
        accessibilityLabel="Search training, courses and tools"
        style={({ pressed }) => [styles.search, pressed ? { opacity: 0.9 } : null]}
      >
        <Search size={20} color={colors.mutedForeground} />
        <Text variant="body" style={{ color: colors.mutedForeground, flex: 1 }}>
          Search training, courses, tools
        </Text>
      </Pressable>

      {/* The three parts of the app: one large tile, two beside each other. */}
      <View style={styles.tiles}>
        <Tile
          large
          icon={<GraduationCap size={20} color={colors.brand} />}
          title="Find training"
          body="Compare fees, course length and the next start date at workshops across Ghana."
          action="Explore training"
          onPress={() => router.navigate("/explore")}
        />
        <View style={styles.tileRow}>
          <Tile
            icon={<PlayCircle size={20} color={colors.brand} />}
            title="Online learning"
            body="Lessons from real workshops."
            action="Courses"
            onPress={() => router.navigate("/learn")}
          />
          <Tile
            icon={<ShoppingBag size={20} color={colors.brand} />}
            title="Marketplace"
            body="Made by trainers and makers."
            action="Shop"
            onPress={() => router.navigate("/shop")}
          />
        </View>
      </View>

      {intakes.data?.length ? (
        <Section title="Starting soon" action="All training" onAction={() => router.navigate("/explore")}>
          <Shelf>
            {intakes.data.map((intake, index) => (
              <IntakeCard key={`${intake.slug}-${intake.start_date}-${index}`} intake={intake} />
            ))}
          </Shelf>
        </Section>
      ) : null}

      <Section title="Featured courses" action="See all" onAction={() => router.navigate("/learn")}>
        {courses.isPending ? (
          <Shelf>
            {[0, 1].map((n) => (
              <Skeleton key={n} style={{ width: 260, height: 260 }} />
            ))}
          </Shelf>
        ) : courses.isError ? (
          <ErrorState message={courses.error.message} onRetry={() => void courses.refetch()} />
        ) : courses.data.results.length ? (
          <Shelf>
            {courses.data.results.slice(0, 10).map((course) => (
              <CourseCard
                key={course.id}
                course={course}
                onPress={() => router.push(`/course/${course.area_slug}/${course.slug}`)}
              />
            ))}
          </Shelf>
        ) : (
          <EmptyState title="No courses yet" body="Workshops are filming their first lessons." />
        )}
      </Section>

      <Section title="Workshops" action="See all" onAction={() => router.navigate("/explore")}>
        {workshops.isPending ? (
          <View style={{ gap: space.md, paddingHorizontal: space.lg }}>
            <Skeleton style={{ height: 120 }} />
            <Skeleton style={{ height: 120 }} />
          </View>
        ) : workshops.isError ? (
          <ErrorState message={workshops.error.message} onRetry={() => void workshops.refetch()} />
        ) : (
          <View style={{ gap: space.md }}>
            {workshops.data.results.slice(0, 3).map((workshop) => (
              <WorkshopRow
                key={workshop.id}
                workshop={workshop}
                onPress={() => router.push(`/workshop/${workshop.area_slug}/${workshop.slug}`)}
              />
            ))}
          </View>
        )}
      </Section>

      <Section title="From the marketplace" action="Shop" onAction={() => router.navigate("/shop")}>
        {products.isPending ? (
          <Shelf>
            {[0, 1, 2].map((n) => (
              <Skeleton key={n} style={{ width: 170, height: 240 }} />
            ))}
          </Shelf>
        ) : products.isError ? (
          <ErrorState message={products.error.message} onRetry={() => void products.refetch()} />
        ) : products.data.results.length ? (
          <Shelf>
            {products.data.results.slice(0, 10).map((product) => (
              <ProductCard
                key={product.id}
                product={product}
                width={170}
                onPress={() => router.push(`/product/${product.id}`)}
              />
            ))}
          </Shelf>
        ) : (
          <EmptyState title="Nothing for sale yet" body="Sellers are adding their first products." />
        )}
      </Section>

      <Section title="How it works">
        <View style={styles.steps}>
          {[
            ["Find", "Search by trade and town. Every listing shows the fee, the length and the next start date."],
            ["Learn", "Watch lessons first, then join a workshop in person or buy the full course."],
            ["Earn", "Open a shop and sell what you make, or list your own workshop and teach."],
          ].map(([title, body], index) => (
            <View key={title} style={styles.step}>
              <View style={styles.stepNumber}>
                <Text style={styles.stepNumberText}>{index + 1}</Text>
              </View>
              <View style={{ flex: 1, gap: 2 }}>
                <Text variant="heading">{title}</Text>
                <Text variant="small">{body}</Text>
              </View>
            </View>
          ))}
        </View>
      </Section>
    </Screen>
  );
}

function Tile({
  icon,
  title,
  body,
  action,
  onPress,
  large = false,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
  action: string;
  onPress: () => void;
  large?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="link"
      accessibilityLabel={`${title}. ${body}`}
      style={({ pressed }) => [styles.tile, large ? styles.tileLarge : styles.tileSmall, pressed ? styles.pressed : null]}
    >
      <View style={styles.tileIcon}>{icon}</View>
      <Text style={styles.tileTitle}>{title}</Text>
      <Text variant="small" numberOfLines={large ? 3 : 2}>
        {body}
      </Text>
      <View style={styles.tileLink}>
        <Text style={styles.tileLinkText}>{action}</Text>
        <ChevronRight size={15} color={colors.brand} />
      </View>
    </Pressable>
  );
}

function IntakeCard({ intake }: { intake: UpcomingIntake }) {
  // "2026-12-07": read as written, so no time zone can move the day.
  const [, month, day] = intake.start_date.split("-");
  return (
    <Pressable
      onPress={() => router.push(`/workshop/${intake.area_slug}/${intake.slug}`)}
      accessibilityRole="link"
      style={({ pressed }) => [styles.intake, pressed ? styles.pressed : null]}
    >
      <View style={styles.intakeTop}>
        <View style={styles.cal}>
          <Text style={styles.calMonth}>{MONTHS[Number(month) - 1]}</Text>
          <Text style={styles.calDay}>{day}</Text>
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={styles.intakeCourse} numberOfLines={1}>
            {intake.course}
          </Text>
          <Text variant="small" numberOfLines={1}>
            {intake.provider} · {intake.area}
          </Text>
        </View>
      </View>
      <View style={styles.intakeFoot}>
        <Text variant="small" numberOfLines={1} style={{ flex: 1 }}>
          {intake.trade}
        </Text>
        <Text style={styles.places}>
          {intake.places_remaining === null
            ? "Open"
            : `${intake.places_remaining} ${intake.places_remaining === 1 ? "place" : "places"} left`}
        </Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  search: {
    marginHorizontal: space.lg,
    marginTop: space.lg,
    flexDirection: "row",
    alignItems: "center",
    gap: space.sm,
    minHeight: 50,
    paddingHorizontal: space.lg,
    borderRadius: radius.md,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.borderStrong,
  },
  tiles: { marginTop: space.xl, paddingHorizontal: space.lg, gap: space.md },
  tileRow: { flexDirection: "row", gap: space.md },
  tile: {
    gap: 4,
    padding: space.lg,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
  },
  tileLarge: { paddingVertical: space.xl },
  tileSmall: { flex: 1 },
  pressed: { borderColor: colors.borderStrong, opacity: 0.92 },
  tileIcon: {
    width: 40,
    height: 40,
    borderRadius: radius.md,
    backgroundColor: colors.brandSoft,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: space.sm,
  },
  tileTitle: { fontFamily: fonts.semibold, fontSize: 17, letterSpacing: -0.2, color: colors.brandDeep },
  tileLink: { flexDirection: "row", alignItems: "center", gap: 2, marginTop: space.sm },
  tileLinkText: { fontFamily: fonts.semibold, fontSize: 14, color: colors.brand },
  intake: {
    width: 270,
    gap: space.md,
    padding: space.lg,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
  },
  intakeTop: { flexDirection: "row", gap: space.md, alignItems: "flex-start" },
  cal: {
    width: 48,
    alignItems: "center",
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.muted,
    paddingVertical: 4,
  },
  calMonth: { fontFamily: fonts.semibold, fontSize: 10, letterSpacing: 0.6, color: colors.mutedForeground },
  calDay: { fontFamily: fonts.semibold, fontSize: 18, color: colors.foreground, fontVariant: ["tabular-nums"] },
  intakeCourse: { fontFamily: fonts.semibold, fontSize: 15, color: colors.foreground },
  intakeFoot: { flexDirection: "row", alignItems: "center", gap: space.sm },
  places: { fontFamily: fonts.semibold, fontSize: 13, color: colors.foreground },
  steps: { paddingHorizontal: space.lg, gap: space.md },
  step: {
    flexDirection: "row",
    gap: space.md,
    padding: space.lg,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
  },
  stepNumber: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: colors.muted,
    alignItems: "center",
    justifyContent: "center",
  },
  stepNumberText: { fontFamily: fonts.semibold, fontSize: 13, color: colors.foreground },
});
