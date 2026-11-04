import { keepPreviousData, useMutation, useQuery } from "@tanstack/react-query";
import * as Location from "expo-location";
import { router, useLocalSearchParams } from "expo-router";
import {
  ArrowLeft,
  BellRing,
  Check,
  ChevronRight,
  GraduationCap,
  LocateFixed,
  PlayCircle,
  Search,
  ShoppingBag,
  Store,
  X,
} from "lucide-react-native";
import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { CourseCard, ProductCard, WorkshopRow } from "@/components/Cards";
import { Shelf } from "@/components/Section";
import { Text } from "@/components/Text";
import { ApiError, api } from "@/lib/api";
import type { ProviderCard, SiteSearch } from "@/lib/types";
import { colors, fonts, radius, shadow, space } from "@/theme/tokens";

/** Wait this long after a key before searching, and this long before counting it. */
const TYPE_DELAY_MS = 250;
const LOG_DELAY_MS = 1500;

function useSettled(value: string, delay: number) {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return settled;
}

/**
 * Search everything as you type: workshops, online courses, products and
 * shops, a few of each. "Welder in Tema" is read as the trade and the town.
 */
export default function SearchScreen() {
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ q?: string }>();
  const [words, setWords] = useState(params.q ?? "");
  const [near, setNear] = useState<{ lat: number; lng: number } | null>(null);
  const [locating, setLocating] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const q = useSettled(words.trim(), TYPE_DELAY_MS);
  const logged = useSettled(q, LOG_DELAY_MS);

  const results = useQuery({
    queryKey: ["site-search", q, near?.lat, near?.lng],
    queryFn: () => api.search(q, near ?? {}),
    enabled: q.length > 0,
    placeholderData: keepPreviousData,
  });
  const popular = useQuery({ queryKey: ["trades"], queryFn: api.trades, staleTime: 10 * 60_000 });

  // Counted once the visitor stops typing, not on every letter.
  useEffect(() => {
    if (logged && logged === q) void api.search(logged, { ...(near ?? {}), log: true }).catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [logged]);

  async function toggleNear() {
    if (near) {
      setNear(null);
      return;
    }
    setLocating(true);
    setNotice(null);
    try {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (!permission.granted) {
        setNotice("Location is off for this app. Type a town instead.");
        return;
      }
      const position =
        (await Location.getLastKnownPositionAsync({ maxAge: 5 * 60_000 })) ??
        (await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }));
      setNear({ lat: position.coords.latitude, lng: position.coords.longitude });
    } catch {
      setNotice("Your position could not be found just now. Try again, or type a town.");
    } finally {
      setLocating(false);
    }
  }

  const data = q ? results.data : undefined;
  const busy = results.isFetching && q.length > 0;

  return (
    <View style={[styles.screen, { paddingTop: insets.top + space.sm }]}>
      <View style={styles.top}>
        <Pressable
          onPress={() => (router.canGoBack() ? router.back() : router.replace("/"))}
          accessibilityRole="button"
          accessibilityLabel="Back"
          hitSlop={8}
          style={styles.round}
        >
          <ArrowLeft size={22} color={colors.foreground} />
        </Pressable>
        <View style={styles.box}>
          {busy ? <ActivityIndicator size="small" color={colors.brand} /> : <Search size={20} color={colors.brand} />}
          <TextInput
            value={words}
            onChangeText={setWords}
            autoFocus
            placeholder="Welder in Tema, sewing, barbing…"
            placeholderTextColor={colors.mutedForeground}
            returnKeyType="search"
            accessibilityLabel="Search workshops, courses, products and shops"
            style={styles.input}
          />
          {words ? (
            <Pressable onPress={() => setWords("")} hitSlop={10} accessibilityRole="button" accessibilityLabel="Clear">
              <X size={18} color={colors.mutedForeground} />
            </Pressable>
          ) : null}
        </View>
        <Pressable
          onPress={() => void toggleNear()}
          accessibilityRole="button"
          accessibilityLabel={near ? "Nearest first, on. Turn off" : "Near me"}
          accessibilityState={{ selected: Boolean(near) }}
          hitSlop={8}
          style={[styles.round, near ? styles.roundOn : null]}
        >
          {locating ? (
            <ActivityIndicator size="small" color={near ? "#fff" : colors.brand} />
          ) : (
            <LocateFixed size={20} color={near ? "#fff" : colors.brand} />
          )}
        </Pressable>
      </View>
      {notice ? (
        <Text variant="small" style={{ paddingHorizontal: space.lg, marginTop: space.sm }}>
          {notice}
        </Text>
      ) : null}

      <ScrollView
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        contentContainerStyle={{ paddingBottom: insets.bottom + space.xxl, paddingTop: space.lg, gap: space.xl }}
      >
        {!q ? (
          <View style={styles.pad}>
            <Text variant="label" style={{ color: colors.mutedForeground }}>
              Popular trades
            </Text>
            <View style={styles.chips}>
              {(popular.data?.results ?? [])
                .filter((trade) => trade.provider_count > 0)
                .slice(0, 8)
                .map((trade) => (
                  <Pressable key={trade.slug} onPress={() => setWords(trade.name)} style={styles.chip} accessibilityRole="button">
                    <Text style={styles.chipText}>{trade.name}</Text>
                  </Pressable>
                ))}
            </View>
            <Text variant="small" style={{ marginTop: space.lg }}>
              Tip: name a trade and a town, like “tailoring Madina”.
            </Text>
          </View>
        ) : results.isError && !data ? (
          <Text variant="body" style={styles.pad}>
            {results.error instanceof ApiError ? results.error.message : "Search did not work. Try again."}
          </Text>
        ) : data ? (
          <Results data={data} onWords={setWords} />
        ) : null}
      </ScrollView>
    </View>
  );
}

function Results({ data, onWords }: { data: SiteSearch; onWords: (words: string) => void }) {
  const { trade, area } = data.understood;
  const nothing = !data.workshops.count && !data.courses.count && !data.products.count && !data.shops.count;
  const trainingParams = trade || area ? { trade: trade?.slug, area: area?.slug } : { q: data.q };
  return (
    <>
        {trade || area ? (
          <Text variant="small" style={styles.pad}>
            Showing{" "}
            <Text style={{ fontFamily: fonts.bold, color: colors.brandDeep }}>
              {trade && area ? `${trade.name} in ${area.name}` : (trade?.name ?? area?.name)}
            </Text>
          </Text>
        ) : null}

        {data.trades.length ? (
          <View style={[styles.pad, { gap: space.sm }]}>
            {data.trades.map((item) => (
              <Pressable
                key={item.slug}
                onPress={() => router.push({ pathname: "/explore", params: { trade: item.slug } })}
                style={({ pressed }) => [styles.tradeRow, pressed ? { opacity: 0.85 } : null]}
                accessibilityRole="button"
              >
                <View style={styles.tradeIcon}>
                  <GraduationCap size={20} color={colors.brand} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text variant="heading">{item.name}</Text>
                  <Text variant="small">
                    {item.provider_count === 1 ? "1 workshop" : `${item.provider_count} workshops`}
                  </Text>
                </View>
                <ChevronRight size={18} color={colors.mutedForeground} />
              </Pressable>
            ))}
          </View>
        ) : null}

        {nothing || (!data.workshops.count && trade) ? <Nothing data={data} onWords={onWords} nothing={nothing} /> : null}

        {data.workshops.count ? (
          <Block
            icon={GraduationCap}
            title="Workshops"
            count={data.workshops.count}
            onAll={() => router.push({ pathname: "/explore", params: trainingParams })}
          >
            <View style={{ gap: space.md }}>
              {data.workshops.results.map((workshop) => (
                <WorkshopRow key={workshop.id} workshop={workshop} onPress={() => openWorkshop(workshop)} />
              ))}
            </View>
          </Block>
        ) : null}

        {data.courses.count ? (
          <Block icon={PlayCircle} title="Online courses" count={data.courses.count} onAll={() => router.navigate("/learn")}>
            <Shelf>
              {data.courses.results.map((course) => (
                <CourseCard
                  key={course.id}
                  course={course}
                  onPress={() => router.push(`/course/${course.area_slug}/${course.slug}`)}
                />
              ))}
            </Shelf>
          </Block>
        ) : null}

        {data.products.count ? (
          <Block icon={ShoppingBag} title="Marketplace" count={data.products.count} onAll={() => router.navigate("/shop")}>
            <Shelf>
              {data.products.results.map((product) => (
                <ProductCard key={product.id} product={product} width={170} onPress={() => router.push(`/product/${product.id}`)} />
              ))}
            </Shelf>
          </Block>
        ) : null}

        {data.shops.count ? (
          <Block icon={Store} title="Shops" count={data.shops.count}>
            <View style={{ gap: space.sm, paddingHorizontal: space.lg }}>
              {data.shops.results.map((shop) => (
                <Pressable key={shop.id} onPress={() => router.push(`/shop/${shop.id}`)} style={styles.tradeRow} accessibilityRole="button">
                  <View style={styles.tradeIcon}>
                    <Store size={20} color={colors.brand} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text variant="heading" numberOfLines={1}>
                      {shop.business_name}
                    </Text>
                    <Text variant="small">{shop.area}</Text>
                  </View>
                  <ChevronRight size={18} color={colors.mutedForeground} />
                </Pressable>
              ))}
            </View>
          </Block>
        ) : null}
    </>
  );
}

function openWorkshop(workshop: ProviderCard) {
  router.push(`/workshop/${workshop.area_slug}/${workshop.slug}`);
}

function Block({
  icon: Icon,
  title,
  count,
  onAll,
  children,
}: {
  icon: typeof Search;
  title: string;
  count: number;
  onAll?: () => void;
  children: React.ReactNode;
}) {
  return (
    <View>
      <View style={styles.blockHead}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
          <Icon size={20} color={colors.brand} />
          <Text variant="title" style={{ fontSize: 19 }}>
            {title}
          </Text>
        </View>
        {onAll ? (
          <Pressable onPress={onAll} hitSlop={8} accessibilityRole="button">
            <Text style={styles.all}>See all {count}</Text>
          </Pressable>
        ) : null}
      </View>
      {children}
    </View>
  );
}

function Nothing({
  data,
  onWords,
  nothing,
}: {
  data: SiteSearch;
  onWords: (words: string) => void;
  /** Nothing at all, rather than no workshop for the trade. */
  nothing: boolean;
}) {
  const { trade, area } = data.understood;
  const alert = useMutation({
    mutationFn: () => api.keepTrainingAlert(trade!.slug, area?.slug),
    onError: (error) => {
      if (error instanceof ApiError && (error.status === 401 || error.status === 403)) router.push("/sign-in");
    },
  });
  return (
    <>
    <View style={[styles.nothing, { marginHorizontal: space.lg }]}>
      <Text variant="title">
        {nothing
          ? `Nothing for “${data.q}” yet`
          : `No ${trade!.name.toLowerCase()} workshop${area ? ` in ${area.name}` : ""} yet`}
      </Text>
      <Text variant="small" style={{ marginTop: 4 }}>
        {nothing ? "Try another word, a nearby town, or one of these." : "We can text you when one opens."}
      </Text>
      {trade ? (
        alert.isSuccess ? (
          <View style={[styles.row, { marginTop: space.md }]}>
            <Check size={18} color={colors.visit} />
            <Text variant="label" style={{ color: colors.visit, flex: 1 }}>
              Done. We&apos;ll text you when a {trade.name.toLowerCase()} workshop opens.
            </Text>
          </View>
        ) : (
          <Pressable
            onPress={() => alert.mutate()}
            disabled={alert.isPending}
            style={({ pressed }) => [styles.alert, pressed ? { opacity: 0.9 } : null]}
            accessibilityRole="button"
          >
            {alert.isPending ? <ActivityIndicator color="#fff" size="small" /> : <BellRing size={18} color="#fff" />}
            <Text style={styles.alertText}>{area ? `Text me when one opens in ${area.name}` : "Text me when one opens"}</Text>
          </Pressable>
        )
      ) : null}
      {data.trades_here.length && area ? (
        <View style={{ marginTop: space.lg }}>
          <Text variant="label">Taught in {area.name}</Text>
          <View style={styles.chips}>
            {data.trades_here.map((here) => (
              <Pressable key={here.slug} onPress={() => onWords(`${here.name} ${area.name}`)} style={styles.chip} accessibilityRole="button">
                <Text style={styles.chipText}>{here.name}</Text>
              </Pressable>
            ))}
          </View>
        </View>
      ) : null}
    </View>
      {data.nearby.length && trade ? (
        <View style={{ marginTop: space.lg, gap: space.md }}>
          <Text variant="label" style={{ paddingHorizontal: space.lg }}>
            {area && nothing
              ? `No ${trade.name.toLowerCase()} workshops in ${area.name} yet. The closest:`
              : `The closest ${trade.name.toLowerCase()} workshops:`}
          </Text>
          {data.nearby.map((workshop) => (
            <WorkshopRow key={workshop.id} workshop={workshop} onPress={() => openWorkshop(workshop)} />
          ))}
        </View>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  top: { flexDirection: "row", alignItems: "center", gap: space.sm, paddingHorizontal: space.lg },
  round: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  roundOn: { backgroundColor: colors.brand, borderColor: colors.brand },
  box: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: space.sm,
    minHeight: 48,
    paddingHorizontal: space.md,
    borderRadius: radius.lg,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    ...shadow.card,
  },
  // minWidth 0 lets the field shrink in its row (it overflowed on the web).
  input: {
    flex: 1,
    minWidth: 0,
    fontFamily: fonts.medium,
    fontSize: 16,
    color: colors.foreground,
    paddingVertical: 10,
    // The box shows it is in use; a second outline on the field (web) hides the clear button.
    outlineWidth: 0,
  },
  pad: { paddingHorizontal: space.lg },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: space.sm, marginTop: space.sm },
  chip: {
    minHeight: 40,
    justifyContent: "center",
    paddingHorizontal: space.lg,
    borderRadius: radius.pill,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
  },
  chipText: { fontFamily: fonts.semibold, fontSize: 14, color: colors.foreground },
  tradeRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.md,
    padding: space.md,
    borderRadius: radius.lg,
    backgroundColor: colors.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  tradeIcon: {
    width: 44,
    height: 44,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.brandSoft,
  },
  blockHead: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: space.lg,
    marginBottom: space.md,
  },
  all: { fontFamily: fonts.semibold, fontSize: 14, color: colors.brand },
  nothing: {
    padding: space.lg,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: colors.borderStrong,
    backgroundColor: colors.card,
  },
  row: { flexDirection: "row", alignItems: "center", gap: space.sm },
  alert: {
    marginTop: space.md,
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: space.sm,
    minHeight: 44,
    paddingHorizontal: space.lg,
    borderRadius: radius.pill,
    backgroundColor: colors.brand,
  },
  alertText: { fontFamily: fonts.bold, fontSize: 14, color: "#fff" },
});
