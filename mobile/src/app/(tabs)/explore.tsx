import { keepPreviousData, useQuery } from "@tanstack/react-query";
import * as Location from "expo-location";
import { router, useLocalSearchParams } from "expo-router";
import { X } from "lucide-react-native";
import { useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from "react-native";

import { WorkshopRow } from "@/components/Cards";
import { MapButton } from "@/components/MapButton";
import { PageHeader } from "@/components/PageHeader";
import { Screen } from "@/components/Screen";
import { EmptyState, ErrorState, Skeleton } from "@/components/States";
import { Text } from "@/components/Text";
import { api } from "@/lib/api";
import { colors, fonts, radius, space } from "@/theme/tokens";

const SORTS = [
  { value: "", label: "Best match" },
  { value: "nearest", label: "Nearest" },
  { value: "cheapest", label: "Cheapest" },
  { value: "soonest", label: "Starting soon" },
] as const;

/** Explore: workshops that teach a trade in person, with fees and intakes.
    "Welder Tema" is read as the trade and the town, as you type. */
export default function ExploreScreen() {
  const params = useLocalSearchParams<{ q?: string; trade?: string; area?: string }>();
  const [q, setQ] = useState(params.q ?? "");
  const [sort, setSort] = useState("");
  const [here, setHere] = useState<{ lat: string; lng: string } | null>(null);
  const [locating, setLocating] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  // Nearest with no position measures from the town searched for.
  const query = {
    q: q || undefined,
    trade: params.trade || undefined,
    area: params.area || undefined,
    sort: sort || undefined,
    ...(sort === "nearest" && here ? { ...here, radius_km: "100" } : {}),
  };
  const workshops = useQuery({
    queryKey: ["providers", query],
    queryFn: () => api.providers(query),
    placeholderData: keepPreviousData,
  });

  async function choose(value: string) {
    setNotice(null);
    if (value !== "nearest" || here) {
      setSort(value);
      return;
    }
    setLocating(true);
    try {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (permission.granted) {
        const position =
          (await Location.getLastKnownPositionAsync({ maxAge: 5 * 60_000 })) ??
          (await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }));
        setHere({ lat: position.coords.latitude.toFixed(3), lng: position.coords.longitude.toFixed(3) });
      } else {
        setNotice("Location is off, so nearest is measured from the town you search for.");
      }
    } catch {
      setNotice("Your position could not be found, so nearest uses the town you search for.");
    } finally {
      setLocating(false);
      setSort("nearest");
    }
  }

  return (
    <Screen refreshing={workshops.isRefetching} onRefresh={() => void workshops.refetch()}>
      <PageHeader
        eyebrow="FIND TRAINING"
        title="Learn in person"
        placeholder="Welder in Tema, sewing, barbing…"
        onSearch={setQ}
        live
        initial={params.q ?? ""}
        action={<MapButton onPress={() => router.push("/map")} />}
      />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.sorts}>
        {SORTS.map((option) => {
          const on = sort === option.value;
          return (
            <Pressable
              key={option.label}
              onPress={() => void choose(option.value)}
              style={[styles.sort, on ? styles.sortOn : null]}
              accessibilityRole="button"
              accessibilityState={{ selected: on }}
            >
              {option.value === "nearest" && locating ? <ActivityIndicator size="small" color={colors.brand} /> : null}
              <Text style={[styles.sortText, on ? { color: "#fff" } : null]}>{option.label}</Text>
            </Pressable>
          );
        })}
      </ScrollView>
      {params.trade || params.area ? (
        <Pressable
          onPress={() => router.setParams({ trade: "", area: "" })}
          style={[styles.sort, styles.filter]}
          accessibilityRole="button"
          accessibilityLabel="Remove this filter"
        >
          <Text style={styles.sortText}>
            {[params.trade, params.area]
              .filter(Boolean)
              .map((slug) => slug!.replace(/-/g, " ").replace(/^./, (c) => c.toUpperCase()))
              .join(" · ")}
          </Text>
          <X size={16} color={colors.mutedForeground} />
        </Pressable>
      ) : null}
      {notice ? (
        <Text variant="small" style={{ paddingHorizontal: space.lg, marginTop: space.sm }}>
          {notice}
        </Text>
      ) : null}
      <View style={{ marginTop: space.lg, gap: space.md }}>
        {workshops.isPending ? (
          [0, 1, 2].map((n) => <Skeleton key={n} style={{ height: 120, marginHorizontal: space.lg }} />)
        ) : workshops.isError ? (
          <ErrorState message={workshops.error.message} onRetry={() => void workshops.refetch()} />
        ) : workshops.data.results.length ? (
          <>
            <Text variant="small" style={{ paddingHorizontal: space.lg }}>
              {workshops.data.count} {workshops.data.count === 1 ? "workshop" : "workshops"}
            </Text>
            {workshops.data.results.map((workshop) => (
              <WorkshopRow
                key={workshop.id}
                workshop={workshop}
                onPress={() => router.push(`/workshop/${workshop.area_slug}/${workshop.slug}`)}
              />
            ))}
          </>
        ) : (
          <View style={{ gap: space.md }}>
            <EmptyState title="No workshops found" body="Try another trade or town, or search everything." />
            {q ? (
              <Pressable
                onPress={() => router.push({ pathname: "/search", params: { q } })}
                style={[styles.sort, styles.sortOn, { alignSelf: "center" }]}
                accessibilityRole="button"
              >
                <Text style={[styles.sortText, { color: "#fff" }]}>Search everything for “{q}”</Text>
              </Pressable>
            ) : null}
          </View>
        )}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  sorts: { gap: space.sm, paddingHorizontal: space.lg, paddingTop: space.md },
  sort: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    minHeight: 38,
    paddingHorizontal: space.lg,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
  },
  sortOn: { backgroundColor: colors.brand, borderColor: colors.brand },
  filter: { alignSelf: "flex-start", marginLeft: space.lg, marginTop: space.sm, backgroundColor: colors.brandSoft, borderColor: colors.brandSoft },
  sortText: { fontFamily: fonts.semibold, fontSize: 14, color: colors.foreground },
});
