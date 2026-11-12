import { useQuery } from "@tanstack/react-query";
import { Image } from "expo-image";
import { router, useLocalSearchParams } from "expo-router";
import {
  BadgeCheck,
  CalendarDays,
  Check,
  Clock3,
  Landmark,
  MapPin,
  Navigation,
  PlayCircle,
  Shield,
  ShieldCheck,
} from "lucide-react-native";
import { Linking, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { BackBar } from "@/components/BackBar";
import { ProductCard } from "@/components/Cards";
import { Button } from "@/components/Form";
import { PhotoPager } from "@/components/PhotoPager";
import { ErrorState, Skeleton } from "@/components/States";
import { Text } from "@/components/Text";
import { api } from "@/lib/api";
import { SITE_URL } from "@/lib/config";
import { cedis, shortDate } from "@/lib/format";
import { photoUrl } from "@/lib/media";
import type { Programme, WorkshopDetail } from "@/lib/types";
import { tradeHex } from "@/theme/trades";
import { colors, fonts, radius, shadow, space } from "@/theme/tokens";

/**
 * A workshop: its photos, the courses it teaches with fees and intakes,
 * who teaches, how to find the gate, and Enquire, which is what most people
 * come here to do.
 */
export default function WorkshopScreen() {
  const { area, slug } = useLocalSearchParams<{ area: string; slug: string }>();
  const insets = useSafeAreaInsets();
  const workshop = useQuery({ queryKey: ["workshop", area, slug], queryFn: () => api.workshop(area, slug) });

  const workshopId = workshop.data?.id;
  const shop = useQuery({
    queryKey: ["products", "workshop", workshopId],
    queryFn: () => api.products({ workshop: String(workshopId) }),
    enabled: workshopId !== undefined,
  });

  if (workshop.isPending) {
    return (
      <View style={styles.screen}>
        <BackBar />
        <Skeleton style={{ height: 300, borderRadius: 0 }} />
        <View style={{ padding: space.lg, gap: space.md }}>
          <Skeleton style={{ height: 28, width: "70%" }} />
          <Skeleton style={{ height: 18, width: "45%" }} />
          <Skeleton style={{ height: 160 }} />
        </View>
      </View>
    );
  }
  if (workshop.isError) {
    return (
      <View style={[styles.screen, { paddingTop: insets.top + 80 }]}>
        <BackBar />
        <ErrorState message={workshop.error.message} onRetry={() => void workshop.refetch()} />
      </View>
    );
  }

  const w = workshop.data;
  const photos = [w.primary_photo, ...w.photos.map((p) => p.image)].filter((p): p is string => Boolean(p));
  const unique = Array.from(new Set(photos)).slice(0, 8);
  const trade = tradeHex(w.trade?.colour);
  const enquire = (programme?: Programme) =>
    router.push({
      pathname: "/enquire",
      params: { area, slug, programme: String(programme?.id ?? w.programmes[0]?.id ?? "") },
    });

  return (
    <View style={styles.screen}>
      <BackBar share={{ message: `${w.name}, ${w.area}, on Fliiptech:`, url: `${SITE_URL}/${area}/${slug}` }} />
      <ScrollView contentContainerStyle={{ paddingBottom: 120 + insets.bottom }}>
        <PhotoPager photos={unique} />

        <View style={styles.sheet}>
          {w.trade ? (
            <View style={[styles.tradeChip, { backgroundColor: trade.bg }]}>
              <Text style={[styles.tradeText, { color: trade.fg }]}>{w.trade.name}</Text>
            </View>
          ) : null}
          <Text variant="display" style={styles.name}>
            {w.name}
          </Text>
          <View style={styles.row}>
            <MapPin size={15} color={colors.mutedForeground} />
            <Text variant="small">
              {w.area}, {w.region}
            </Text>
          </View>

          {/* Both badges, always, as on the website: "not visited" and "not
              registered" are real answers and are shown, or a visit and a
              registration would mean nothing. Never merged into one. */}
          <View style={styles.badges}>
            {!w.site_visit ? (
              <Badge icon={<Shield size={14} color={colors.mutedForeground} />} tone="muted">
                Not visited by Fliiptech
              </Badge>
            ) : w.site_visit.outcome === "failed" ? (
              <Badge icon={<Shield size={14} color={colors.mutedForeground} />} tone="muted">
                Fliiptech visit {shortDate(w.site_visit.visited_on)}: not passed
              </Badge>
            ) : (
              <Badge icon={<BadgeCheck size={14} color={colors.visit} />} tone="visit">
                Visited by Fliiptech {shortDate(w.site_visit.visited_on)}
              </Badge>
            )}
            <Badge
              icon={
                <Landmark
                  size={14}
                  color={w.government_status.registration_status === "registered" ? colors.brand : colors.mutedForeground}
                />
              }
              tone={w.government_status.registration_status === "registered" ? undefined : "muted"}
            >
              CTVET: {GOVERNMENT[w.government_status.registration_status] ?? w.government_status.label}
            </Badge>
          </View>

          <View style={styles.facts}>
            <Fact label="From" value={w.lowest_fee ? cedis(w.lowest_fee) : "Ask"} />
            <Fact
              label="Shortest course"
              value={w.shortest_duration_weeks ? `${w.shortest_duration_weeks} weeks` : "—"}
            />
            <Fact label="Next intake" value={w.next_intake ? shortDate(w.next_intake) : "Ask"} highlight />
          </View>
        </View>

        {/* ---------------------------------------------------- courses */}
        <Section title={w.programmes.length === 1 ? "The course" : `${w.programmes.length} courses`}>
          {w.programmes.map((programme) => (
            <ProgrammeCard key={programme.id} programme={programme} onEnquire={() => enquire(programme)} />
          ))}
          {w.programmes.length === 0 ? (
            <Text variant="small">This workshop has not listed its courses yet. Ask them about joining.</Text>
          ) : null}
        </Section>

        {w.videos.length ? (
          <Pressable
            onPress={() => router.push(`/course/${area}/${slug}`)}
            style={styles.lessons}
            accessibilityRole="link"
          >
            <PlayCircle size={28} color="#ffffff" />
            <View style={{ flex: 1 }}>
              <Text style={styles.lessonsTitle}>Watch their lessons</Text>
              <Text style={styles.lessonsBody}>
                {w.videos.length} {w.videos.length === 1 ? "video" : "videos"} filmed in this workshop
              </Text>
            </View>
          </Pressable>
        ) : null}

        {/* ------------------------------------------- what they sell, if any */}
        {shop.data?.results.length ? (
          <Section title="Shop at this workshop">
            <Text variant="small" style={{ marginTop: -space.sm, marginBottom: space.md }}>
              Things {w.name} makes and sells. Pay safely on Fliiptech or ask them about it.
            </Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ gap: space.md, paddingRight: space.lg }}
              style={{ marginHorizontal: -space.lg, paddingLeft: space.lg }}
            >
              {shop.data.results.slice(0, 10).map((product) => (
                <ProductCard
                  key={product.id}
                  product={product}
                  width={150}
                  onPress={() => router.push(`/product/${product.id}`)}
                />
              ))}
            </ScrollView>
          </Section>
        ) : null}

        {/* ---------------------------------------------------- the trainer */}
        {w.master ? (
          <Section title="Who teaches">
            <View style={styles.master}>
              <View style={styles.portrait}>
                {w.master.portrait ? (
                  <Image source={photoUrl(w.master.portrait)} style={StyleSheet.absoluteFill} contentFit="cover" />
                ) : (
                  <Text style={styles.initial}>{w.master.name.slice(0, 1)}</Text>
                )}
              </View>
              <View style={{ flex: 1, gap: 2 }}>
                <Text variant="heading">{w.master.name}</Text>
                {w.master.years_in_trade ? (
                  <Text variant="small">{w.master.years_in_trade} years in the trade</Text>
                ) : null}
                {w.master.apprentices_trained ? (
                  <Text variant="small">{w.master.apprentices_trained} apprentices trained</Text>
                ) : null}
              </View>
            </View>
          </Section>
        ) : null}

        {/* ---------------------------------------------------- find the gate */}
        <Section title="Finding the workshop">
          <View style={styles.card}>
            {w.entrance_photo ? (
              <Image source={photoUrl(w.entrance_photo, "full")} style={styles.entrance} contentFit="cover" />
            ) : null}
            {w.address ? <Text variant="body">{w.address}</Text> : null}
            {w.directions ? <Text variant="small">{w.directions}</Text> : null}
            <Button
              label="Directions"
              tone="soft"
              icon={<Navigation size={18} color={colors.brand} />}
              onPress={() => openDirections(w)}
            />
          </View>
        </Section>

        <View style={[styles.row, styles.safety]}>
          <ShieldCheck size={16} color={colors.mutedForeground} />
          <Text variant="small" style={{ flex: 1 }}>
            Never pay a fee before visiting the workshop. Report anything that feels wrong from the website.
          </Text>
        </View>
      </ScrollView>

      {/* ---------------------------------------------------- enquire */}
      <View style={[styles.cta, { paddingBottom: insets.bottom + space.md }]}>
        <View style={{ flex: 1 }}>
          <Text variant="small">Free to ask. They reply by phone or WhatsApp.</Text>
        </View>
        <Button label="Enquire" onPress={() => enquire()} disabled={!w.programmes.length} style={{ minWidth: 140 }} />
      </View>
    </View>
  );
}

function openDirections(w: WorkshopDetail) {
  const label = encodeURIComponent(w.name);
  Linking.openURL(`geo:${w.lat},${w.lng}?q=${w.lat},${w.lng}(${label})`).catch(() =>
    Linking.openURL(`https://www.openstreetmap.org/?mlat=${w.lat}&mlon=${w.lng}#map=17/${w.lat}/${w.lng}`),
  );
}

function ProgrammeCard({ programme, onEnquire }: { programme: Programme; onEnquire: () => void }) {
  // What the fee covers and what it does not, as the website's receipt
  // does: two fees are only comparable when both say. A certificate nobody
  // awards is not an extra cost, so it is left out of the extras.
  const items: [string, boolean][] = [
    ["Tools", programme.fee_includes_tools],
    ["Materials", programme.fee_includes_materials],
    ["Safety gear", programme.fee_includes_ppe],
    ["Certificate", programme.fee_includes_certificate],
  ];
  const includes = items.filter(([, covered]) => covered).map(([item]) => item);
  const extras = items
    .filter(([item, covered]) => !covered && (item !== "Certificate" || Boolean(programme.certificate_awarded)))
    .map(([item]) => item.toLowerCase());
  const open = programme.intakes.filter((intake) => intake.is_open);
  return (
    <View style={styles.card}>
      <Text variant="heading">{programme.title}</Text>
      <View style={styles.feeRow}>
        <Text style={styles.fee}>{cedis(programme.fee)}</Text>
        {programme.instalments_allowed ? <Text variant="small">· instalments possible</Text> : null}
      </View>
      <View style={styles.row}>
        <Clock3 size={14} color={colors.mutedForeground} />
        <Text variant="small">
          {programme.duration_weeks} weeks
          {programme.hours_per_week ? ` · ${programme.hours_per_week} hours a week` : ""}
          {programme.weekly_schedule ? ` · ${programme.weekly_schedule}` : ""}
        </Text>
      </View>
      {includes.length ? (
        <View style={styles.includes}>
          {includes.map((item) => (
            <View key={item} style={styles.include}>
              <Check size={13} color={colors.visit} />
              <Text style={styles.includeText}>{item}</Text>
            </View>
          ))}
        </View>
      ) : null}
      {extras.length ? <Text variant="small">Not in the fee: {extras.join(", ")}.</Text> : null}
      {programme.extra_costs ? (
        <Text variant="small">
          Expect about {cedis(programme.extra_costs)} more{programme.extra_costs_note ? `: ${programme.extra_costs_note}` : ""}.
        </Text>
      ) : null}
      {open.length ? (
        <View style={{ gap: 6 }}>
          {open.slice(0, 3).map((intake) => (
            <View key={intake.id} style={styles.intake}>
              <CalendarDays size={15} color={colors.visit} />
              <Text style={styles.intakeText}>Starts {shortDate(intake.start_date)}</Text>
              {intake.places_remaining !== null ? (
                <Text variant="small">
                  {intake.places_remaining} {intake.places_remaining === 1 ? "place" : "places"} left
                </Text>
              ) : null}
            </View>
          ))}
        </View>
      ) : (
        <Text variant="small">No intake dates yet: ask when the next one starts.</Text>
      )}
      <Button label="Enquire about this course" tone="soft" onPress={onEnquire} />
    </View>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Text variant="title">{title}</Text>
      <View style={{ gap: space.md, marginTop: space.md }}>{children}</View>
    </View>
  );
}

function Fact({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <View style={styles.fact}>
      <Text variant="small">{label}</Text>
      <Text style={[styles.factValue, highlight ? { color: colors.visit } : null]}>{value}</Text>
    </View>
  );
}

/** CTVET status as the website words it, by the code the API sends. */
const GOVERNMENT: Record<string, string> = {
  registered: "Registered",
  not_registered: "Not registered",
  not_claimed: "Not claimed",
  claimed_not_verified: "Claimed, not independently verified",
};

function Badge({
  icon,
  children,
  tone,
}: {
  icon: React.ReactNode;
  children: React.ReactNode;
  tone?: "visit" | "muted";
}) {
  const toneStyle = tone ? TONES[tone] : null;
  return (
    <View style={[styles.badge, toneStyle ? { backgroundColor: toneStyle.bg } : null]}>
      {icon}
      <Text style={[styles.badgeText, toneStyle ? { color: toneStyle.fg } : null]}>{children}</Text>
    </View>
  );
}

const TONES = {
  visit: { bg: colors.visitBg, fg: colors.visit },
  muted: { bg: colors.muted, fg: colors.mutedForeground },
} as const;

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  sheet: {
    marginTop: -24,
    paddingHorizontal: space.lg,
    paddingTop: space.xl,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    backgroundColor: colors.background,
    gap: space.sm,
  },
  tradeChip: { alignSelf: "flex-start", paddingHorizontal: 10, paddingVertical: 3, borderRadius: radius.pill },
  tradeText: { fontFamily: fonts.bold, fontSize: 12 },
  name: { fontSize: 27, lineHeight: 31 },
  row: { flexDirection: "row", alignItems: "center", gap: 6 },
  badges: { flexDirection: "row", flexWrap: "wrap", gap: space.sm, marginTop: space.xs },
  badge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: radius.pill,
    backgroundColor: colors.brandSoft,
  },
  badgeText: { fontFamily: fonts.semibold, fontSize: 12, color: colors.brand },
  facts: {
    marginTop: space.md,
    flexDirection: "row",
    borderRadius: radius.lg,
    backgroundColor: colors.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    ...shadow.card,
  },
  fact: { flex: 1, padding: space.md, gap: 2 },
  factValue: { fontFamily: fonts.extrabold, fontSize: 16, color: colors.brandDeep },
  section: { marginTop: space.xxl, paddingHorizontal: space.lg },
  card: {
    padding: space.lg,
    gap: space.sm,
    borderRadius: radius.lg,
    backgroundColor: colors.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    ...shadow.card,
  },
  feeRow: { flexDirection: "row", alignItems: "baseline", gap: 6 },
  fee: { fontFamily: fonts.extrabold, fontSize: 22, color: colors.brandDeep },
  includes: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  include: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: radius.pill,
    backgroundColor: colors.visitBg,
  },
  includeText: { fontFamily: fonts.semibold, fontSize: 12, color: colors.visit },
  intake: { flexDirection: "row", alignItems: "center", gap: 6 },
  intakeText: { fontFamily: fonts.semibold, fontSize: 14, color: colors.visit },
  lessons: {
    marginTop: space.xl,
    marginHorizontal: space.lg,
    flexDirection: "row",
    alignItems: "center",
    gap: space.md,
    padding: space.lg,
    borderRadius: radius.lg,
    backgroundColor: colors.brandDeep,
  },
  lessonsTitle: { fontFamily: fonts.bold, fontSize: 16, color: "#ffffff" },
  lessonsBody: { fontFamily: fonts.regular, fontSize: 13, color: "rgba(255,255,255,0.75)" },
  master: { flexDirection: "row", alignItems: "center", gap: space.md },
  portrait: {
    width: 64,
    height: 64,
    borderRadius: 32,
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.brandSoft,
  },
  initial: { fontFamily: fonts.extrabold, fontSize: 24, color: colors.brand },
  entrance: { height: 170, borderRadius: radius.md, backgroundColor: colors.muted },
  safety: { marginTop: space.xl, paddingHorizontal: space.lg },
  cta: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: space.md,
    paddingHorizontal: space.lg,
    paddingTop: space.md,
    backgroundColor: colors.card,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    ...shadow.floating,
  },
});
