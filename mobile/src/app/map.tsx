import { useQuery } from "@tanstack/react-query";
import * as Location from "expo-location";
import { router } from "expo-router";
import { LocateFixed, RefreshCw, Search } from "lucide-react-native";
import { useMemo, useState } from "react";
import { ActivityIndicator, Linking, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { MapButton } from "@/components/MapButton";
import { WorkshopMap } from "@/components/map/WorkshopMap";
import { WorkshopSheet } from "@/components/map/WorkshopSheet";
import { Text } from "@/components/Text";
import { api } from "@/lib/api";
import { bboxParam, boundsOf, type Bounds } from "@/lib/map";
import { openOnSite } from "@/lib/open";
import type { ProviderCard } from "@/lib/types";
import { tradeHex } from "@/theme/trades";
import { colors, fonts, radius, shadow, space } from "@/theme/tokens";

const SHEET_SPACE = 236;

/**
 * Every workshop on a map: pins in their trade's colour, grouped when they
 * crowd, a filter by trade, "near me", and "search this area" after panning.
 * Opened from the map button on Explore and Home; the list button in the
 * same corner goes back.
 */
export default function MapScreen() {
  const insets = useSafeAreaInsets();
  const [trade, setTrade] = useState("");
  const [area, setArea] = useState<Bounds | null>(null);
  const [moved, setMoved] = useState<Bounds | null>(null);
  const [selected, setSelected] = useState<ProviderCard | null>(null);
  const [flyTo, setFlyTo] = useState<{ center: [number, number]; zoom: number; nonce: number } | null>(null);
  const [showUser, setShowUser] = useState(false);
  const [locating, setLocating] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  // The results to frame: those for a newly chosen trade, never those of a
  // "search this area", where the learner already chose the view.
  const [frameKey, setFrameKey] = useState("|");

  const trades = useQuery({ queryKey: ["trades"], queryFn: api.trades, staleTime: 60 * 60_000 });
  const key = `${trade}|${area ? bboxParam(area) : ""}`;
  const workshops = useQuery({
    queryKey: ["map", key],
    queryFn: () => api.mapProviders({ trade: trade || undefined, bbox: area ? bboxParam(area) : undefined }),
  });

  const fitTo = useMemo(() => {
    if (!workshops.data || frameKey !== key) return null;
    const bounds = boundsOf(workshops.data);
    return bounds ? { bounds, nonce: workshops.dataUpdatedAt } : null;
  }, [workshops.data, workshops.dataUpdatedAt, frameKey, key]);

  function chooseTrade(slug: string) {
    setTrade(slug);
    setArea(null);
    setMoved(null);
    setSelected(null);
    setFrameKey(`${slug}|`);
  }

  async function nearMe() {
    setLocating(true);
    setNotice(null);
    try {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (!permission.granted) {
        setNotice("Location is off for this app. You can still move the map to your town.");
        return;
      }
      const position =
        (await Location.getLastKnownPositionAsync({ maxAge: 5 * 60_000 })) ??
        (await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }));
      setShowUser(true);
      setFlyTo({ center: [position.coords.longitude, position.coords.latitude], zoom: 12.5, nonce: Date.now() });
    } catch {
      setNotice("Your position could not be found just now. Try again outside or with location turned on.");
    } finally {
      setLocating(false);
    }
  }

  function directions(workshop: ProviderCard) {
    const label = encodeURIComponent(workshop.name);
    // geo: opens whichever maps app the phone has; the web map otherwise.
    Linking.openURL(`geo:${workshop.lat},${workshop.lng}?q=${workshop.lat},${workshop.lng}(${label})`).catch(() =>
      Linking.openURL(
        `https://www.openstreetmap.org/?mlat=${workshop.lat}&mlon=${workshop.lng}#map=17/${workshop.lat}/${workshop.lng}`,
      ),
    );
  }

  const count = workshops.data?.length ?? 0;
  const tradeOptions = trades.data?.results.filter((option) => option.provider_count > 0) ?? [];
  const bottom = insets.bottom + space.lg;

  return (
    <View style={styles.screen}>
      <WorkshopMap
        workshops={workshops.data ?? []}
        selectedId={selected?.id ?? null}
        onSelect={setSelected}
        onMoved={(bounds, byUser) => {
          if (byUser) setMoved(bounds);
        }}
        fitTo={fitTo}
        flyTo={flyTo}
        showUser={showUser}
        insets={{ top: insets.top + 120, bottom: selected ? SHEET_SPACE : bottom + 40 }}
      />

      {/* ------------------------------------------------ top: title, chips */}
      <View pointerEvents="box-none" style={[styles.top, { paddingTop: insets.top + space.sm }]}>
        <View style={styles.titleRow}>
          <View style={styles.titlePill}>
            <Text style={styles.title}>Training map</Text>
            <Text variant="small">
              {workshops.isPending ? "Loading…" : `${count} ${count === 1 ? "workshop" : "workshops"}`}
            </Text>
          </View>
          <MapButton mode="list" onPress={() => (router.canGoBack() ? router.back() : router.replace("/explore"))} />
        </View>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chips}
          style={styles.chipStrip}
        >
          <Chip label="All trades" active={!trade} onPress={() => chooseTrade("")} />
          {tradeOptions.map((option) => (
            <Chip
              key={option.slug}
              label={option.name}
              colour={tradeHex(option.colour).strong}
              active={trade === option.slug}
              onPress={() => chooseTrade(option.slug)}
            />
          ))}
        </ScrollView>

        {moved && !workshops.isFetching ? (
          <Pressable
            onPress={() => {
              setArea(moved);
              setMoved(null);
              setSelected(null);
            }}
            style={styles.searchArea}
            accessibilityRole="button"
          >
            <Search size={16} color="#ffffff" />
            <Text style={styles.searchAreaText}>Search this area</Text>
          </Pressable>
        ) : null}
        {workshops.isFetching ? (
          <View style={styles.status}>
            <ActivityIndicator size="small" color={colors.brand} />
            <Text variant="label">Finding workshops…</Text>
          </View>
        ) : workshops.isError ? (
          <Pressable onPress={() => void workshops.refetch()} style={styles.status} accessibilityRole="button">
            <RefreshCw size={16} color={colors.destructive} />
            <Text variant="label">No connection. Tap to try again.</Text>
          </Pressable>
        ) : !workshops.isPending && count === 0 ? (
          <View style={styles.status}>
            <Text variant="label">No workshops here. Try another trade or area.</Text>
          </View>
        ) : null}
        {notice ? (
          <Pressable onPress={() => setNotice(null)} style={[styles.status, styles.notice]}>
            <Text variant="small" style={{ color: colors.foreground }}>
              {notice}
            </Text>
          </Pressable>
        ) : null}
      </View>

      {/* ------------------------------------------------ near me */}
      <Pressable
        onPress={() => void nearMe()}
        accessibilityRole="button"
        accessibilityLabel="Show workshops near me"
        style={[styles.locate, { bottom: (selected ? SHEET_SPACE : bottom) + space.md }]}
      >
        {locating ? (
          <ActivityIndicator size="small" color={colors.brand} />
        ) : (
          <LocateFixed size={22} color={colors.brand} />
        )}
      </Pressable>

      {selected ? (
        <WorkshopSheet
          key={selected.id}
          workshop={selected}
          bottom={bottom}
          onClose={() => setSelected(null)}
          onView={() => void openOnSite(`/${selected.area_slug}/${selected.slug}`)}
          onDirections={() => directions(selected)}
        />
      ) : null}
    </View>
  );
}

function Chip({
  label,
  active,
  colour,
  onPress,
}: {
  label: string;
  active: boolean;
  colour?: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      style={[styles.chip, active ? styles.chipActive : null]}
    >
      {colour ? <View style={[styles.swatch, { backgroundColor: colour }]} /> : null}
      <Text style={[styles.chipText, active ? styles.chipTextActive : null]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#e8e4dc" },
  top: { position: "absolute", left: 0, right: 0, top: 0, gap: space.sm },
  titleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: space.md,
    paddingHorizontal: space.lg,
  },
  titlePill: {
    flexShrink: 1,
    paddingHorizontal: space.lg,
    paddingVertical: space.sm,
    borderRadius: radius.lg,
    backgroundColor: colors.card,
    ...shadow.card,
  },
  title: { fontFamily: fonts.extrabold, fontSize: 17, color: colors.brandDeep },
  chipStrip: { flexGrow: 0 },
  chips: { paddingHorizontal: space.lg, gap: space.sm },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    minHeight: 38,
    paddingHorizontal: 14,
    borderRadius: radius.pill,
    backgroundColor: colors.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    ...shadow.card,
  },
  chipActive: { backgroundColor: colors.brand, borderColor: colors.brand },
  swatch: { width: 10, height: 10, borderRadius: 5 },
  chipText: { fontFamily: fonts.semibold, fontSize: 13, color: colors.foreground },
  chipTextActive: { color: "#ffffff" },
  searchArea: {
    alignSelf: "center",
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    minHeight: 40,
    paddingHorizontal: space.lg,
    borderRadius: radius.pill,
    backgroundColor: colors.brandDeep,
    ...shadow.floating,
  },
  searchAreaText: { fontFamily: fonts.bold, fontSize: 14, color: "#ffffff" },
  status: {
    alignSelf: "center",
    flexDirection: "row",
    alignItems: "center",
    gap: space.sm,
    maxWidth: "88%",
    paddingHorizontal: space.lg,
    paddingVertical: space.sm,
    borderRadius: radius.pill,
    backgroundColor: colors.card,
    ...shadow.card,
  },
  notice: { borderRadius: radius.md, backgroundColor: colors.warnBg },
  locate: {
    position: "absolute",
    right: space.lg,
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.card,
    ...shadow.floating,
  },
});
