import { useEvent, useEventListener } from "expo";
import { Image } from "expo-image";
import { router, useLocalSearchParams } from "expo-router";
import { useVideoPlayer, VideoView, type VideoSource as PlayerSource } from "expo-video";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Award, CircleCheck, CirclePlay, CloudDownload, Lock, MapPin, ExternalLink, Trash } from "lucide-react-native";
import { useMemo, useRef, useState } from "react";
import { Alert, Linking, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { BackBar } from "@/components/BackBar";
import { ProductCard } from "@/components/Cards";
import { BundleCard } from "@/components/market/BundleCard";
import { Button } from "@/components/Form";
import { ErrorState, Skeleton } from "@/components/States";
import { Text } from "@/components/Text";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { cedis, courseLength } from "@/lib/format";
import { mediaUrl } from "@/lib/media";
import { forgetLesson, saveLesson, savedLesson } from "@/lib/offline";
import { openOnSite } from "@/lib/open";
import { payOnPaystack } from "@/lib/pay";
import { token } from "@/lib/session";
import type { CourseAccess, Lesson } from "@/lib/types";
import { colors, fonts, radius, shadow, space } from "@/theme/tokens";

/** How often the player reports where the trainee is, in seconds. */
const PROGRESS_EVERY = 10;

/**
 * A course: watch its lessons, keep your place, save lessons for no-data
 * days, buy a paid course with Paystack, and get the certificate at the end.
 * The same API as the website's player, signed in with the app's token.
 */
export default function CourseScreen() {
  const { area, slug, lesson: startAt } = useLocalSearchParams<{ area: string; slug: string; lesson?: string }>();
  const insets = useSafeAreaInsets();
  const auth = useAuth();
  const client = useQueryClient();
  const course = useQuery({
    queryKey: ["course", area, slug],
    queryFn: () => api.course(area, slug),
  });
  const access = useQuery({
    queryKey: ["course-access", area, slug, auth.signedIn],
    queryFn: () => api.courseAccess(area, slug),
  });
  const tools = useQuery({ queryKey: ["course-tools", area, slug], queryFn: () => api.courseTools(area, slug) });
  const bundles = useQuery({ queryKey: ["course-bundles", area, slug], queryFn: () => api.courseBundles(area, slug) });
  const [current, setCurrent] = useState<number | null>(startAt ? Number(startAt) : null);
  const [buying, setBuying] = useState(false);
  // Lessons saved on this phone: what was there when the course opened, and
  // what was saved or removed since.
  const [savedChanges, setSaved] = useState<Record<number, string | null>>({});
  const [saving, setSaving] = useState<Record<number, number>>({});

  const lessons = useMemo(() => course.data?.lessons ?? [], [course.data]);
  const onPhone = useMemo(() => {
    const found: Record<number, string> = {};
    for (const lesson of lessons) {
      const uri = savedLesson(lesson.id);
      if (uri) found[lesson.id] = uri;
    }
    return found;
  }, [lessons]);
  const saved: Record<number, string | undefined> = { ...onPhone };
  for (const [id, uri] of Object.entries(savedChanges)) saved[Number(id)] = uri ?? undefined;
  const progress = access.data?.progress ?? {};
  const done = lessons.filter((lesson) => progress[lesson.id]?.completed).length;
  const playable = (lesson: Lesson) => Boolean(saved[lesson.id] || canStream(lesson, access.data));

  // Start where they left off: the first lesson not finished, else the first.
  const active =
    lessons.find((lesson) => lesson.id === current) ??
    lessons.find((lesson) => playable(lesson) && !progress[lesson.id]?.completed) ??
    lessons[0];

  function refresh() {
    void client.invalidateQueries({ queryKey: ["course-access", area, slug] });
    void client.invalidateQueries({ queryKey: ["my-courses"] });
  }

  async function buy() {
    if (!auth.signedIn) {
      router.push({
        pathname: "/sign-in",
        params: { why: "to buy this course" },
      });
      return;
    }
    setBuying(true);
    try {
      await auth.ensureTrainee();
      const started = await api.buyCourse(area, slug);
      await payOnPaystack(started.authorization_url);
      const result = await api.verifyCourse(started.reference);
      refresh();
      if (result.owned) Alert.alert("It is yours", "Every lesson is open. Enjoy the course.");
      else Alert.alert("Not paid yet", "If money left your account, the course opens within a few minutes.");
    } catch (error) {
      Alert.alert("That did not work", error instanceof ApiError ? error.message : "Try again in a minute.");
    } finally {
      setBuying(false);
    }
  }

  async function save(lesson: Lesson) {
    const sources = access.data?.sources[lesson.id] ?? [];
    setSaving((now) => ({ ...now, [lesson.id]: 0 }));
    try {
      const uri = await saveLesson(
        lesson.id,
        sources.map((source) => ({
          ...source,
          url: mediaUrl(source.url) ?? source.url,
        })),
        (share) => setSaving((now) => ({ ...now, [lesson.id]: share })),
      );
      setSaved((now) => ({ ...now, [lesson.id]: uri }));
    } catch {
      Alert.alert("Not saved", "Check your connection and try again.");
    } finally {
      setSaving(({ [lesson.id]: _, ...rest }) => rest);
    }
  }

  function unsave(lesson: Lesson) {
    forgetLesson(lesson.id);
    setSaved((now) => ({ ...now, [lesson.id]: null }));
  }

  if (course.isError) {
    return (
      <View style={[styles.screen, { paddingTop: insets.top + 80 }]}>
        <BackBar />
        <ErrorState message="This course did not load." onRetry={() => void course.refetch()} />
      </View>
    );
  }

  const data = course.data;
  const price = access.data?.price;
  const owned = access.data?.owned ?? false;
  const locked = lessons.some((lesson) => lesson.kind === "upload" && !canStream(lesson, access.data));
  const sections = groupBySection(lessons);

  return (
    <View style={styles.screen}>
      <View style={{ paddingTop: insets.top, backgroundColor: "#000" }}>
        {active && playable(active) ? (
          <Player
            key={active.id}
            lesson={active}
            source={sourceFor(active, access.data, saved[active.id])}
            startAt={progress[active.id]?.completed ? 0 : (progress[active.id]?.position ?? 0)}
            report={auth.signedIn}
            onProgress={refresh}
            onEnd={() => {
              const next = lessons[lessons.indexOf(active) + 1];
              if (next && playable(next)) setCurrent(next.id);
            }}
          />
        ) : (
          <LockedPoster poster={active?.poster ?? data?.course.poster ?? null} loading={!data || access.isPending} />
        )}
      </View>
      <BackBar />

      <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + 120 }}>
        {!data ? (
          <View style={{ padding: space.lg, gap: space.md }}>
            <Skeleton style={{ height: 28, width: "70%" }} />
            <Skeleton style={{ height: 18, width: "40%" }} />
            <Skeleton style={{ height: 240 }} />
          </View>
        ) : (
          <>
            <View style={styles.head}>
              {data.course.trade ? <Text variant="eyebrow">{data.course.trade.name.toUpperCase()}</Text> : null}
              <Text variant="title" style={{ marginTop: 4 }}>
                {active?.title ?? data.course.name}
              </Text>
              <Text variant="small" style={{ marginTop: 4 }}>
                {data.course.name} · {data.course.area} · {courseLength(data.course.lessons, data.course.total_seconds)}
              </Text>
              {auth.signedIn && lessons.length ? (
                <View style={styles.progress}>
                  <View style={styles.track}>
                    <View style={[styles.fill, { width: `${(done / lessons.length) * 100}%` }]} />
                  </View>
                  <Text variant="label">
                    {done} of {lessons.length} done
                  </Text>
                </View>
              ) : null}
            </View>

            {access.data?.certificate ? (
              <Pressable
                onPress={() => void openOnSite(access.data!.certificate!.path)}
                style={[styles.card, styles.certificate]}
                accessibilityRole="link"
              >
                <Award size={28} color={colors.warn} />
                <View style={{ flex: 1 }}>
                  <Text variant="heading">You finished the course</Text>
                  <Text variant="small">See and share your certificate</Text>
                </View>
              </Pressable>
            ) : null}

            {price && !owned && locked ? (
              <View style={[styles.card, styles.buy]}>
                <View
                  style={{
                    flexDirection: "row",
                    alignItems: "baseline",
                    gap: space.sm,
                  }}
                >
                  <Text style={styles.price}>{cedis(price)}</Text>
                  {access.data?.full_price ? <Text style={styles.was}>{cedis(access.data.full_price)}</Text> : null}
                </View>
                <Text variant="small">
                  One payment. Every lesson, yours to keep, with a certificate when you finish. Free lessons stay free.
                </Text>
                {access.data?.payments_enabled ? (
                  <Button
                    label={auth.signedIn ? "Unlock the course" : "Sign in to buy"}
                    busy={buying}
                    onPress={() => void buy()}
                  />
                ) : (
                  <Text variant="label">Buying is not open yet. Try again soon.</Text>
                )}
                <Text variant="small" style={{ textAlign: "center" }}>
                  Pay with MoMo or card on Paystack. It comes back here when done.
                </Text>
              </View>
            ) : null}

            <View style={styles.section}>
              <Text variant="heading">Lessons</Text>
              {sections.map(([heading, rows]) => (
                <View key={heading || "lessons"} style={{ marginTop: space.md }}>
                  {heading ? (
                    <Text variant="label" style={styles.sectionTitle}>
                      {heading}
                    </Text>
                  ) : null}
                  <View style={styles.list}>
                    {rows.map((lesson, index) => (
                      <LessonRow
                        key={lesson.id}
                        number={lessons.indexOf(lesson) + 1}
                        lesson={lesson}
                        first={index === 0}
                        active={lesson.id === active?.id}
                        done={Boolean(progress[lesson.id]?.completed)}
                        open={playable(lesson)}
                        canSave={Boolean(access.data?.sources[lesson.id]?.length)}
                        saved={Boolean(saved[lesson.id])}
                        saving={saving[lesson.id]}
                        onPress={() =>
                          lesson.kind === "youtube"
                            ? void Linking.openURL(`https://www.youtube.com/watch?v=${lesson.youtube_id}`)
                            : playable(lesson)
                              ? setCurrent(lesson.id)
                              : void buy()
                        }
                        onSave={() => void save(lesson)}
                        onUnsave={() => unsave(lesson)}
                      />
                    ))}
                  </View>
                </View>
              ))}
            </View>

            {data.details.summary || data.details.outcomes.length ? (
              <View style={styles.section}>
                <Text variant="heading">About this course</Text>
                {data.details.summary ? (
                  <Text
                    style={{
                      marginTop: space.sm,
                      color: colors.mutedForeground,
                    }}
                  >
                    {data.details.summary}
                  </Text>
                ) : null}
                {data.details.outcomes.length ? (
                  <View style={{ marginTop: space.md, gap: space.sm }}>
                    <Text variant="label">You will be able to</Text>
                    {data.details.outcomes.map((outcome) => (
                      <View key={outcome} style={styles.bullet}>
                        <CircleCheck size={16} color={colors.visit} />
                        <Text style={{ flex: 1 }}>{outcome}</Text>
                      </View>
                    ))}
                  </View>
                ) : null}
                {data.details.tools.length ? (
                  <Text variant="small" style={{ marginTop: space.md }}>
                    You will need: {data.details.tools.join(", ")}
                  </Text>
                ) : null}
              </View>
            ) : null}

            {(bundles.data?.results ?? []).some((bundle) => bundle.buy_online) ? (
              <View style={styles.section}>
                <Text variant="heading">Learn and buy</Text>
                <Text variant="small">The course and the tools for it, together for less.</Text>
                <View style={{ gap: space.md, marginTop: space.md }}>
                  {bundles.data!.results
                    .filter((bundle) => bundle.buy_online)
                    .map((bundle) => (
                      <BundleCard key={bundle.id} bundle={bundle} />
                    ))}
                </View>
              </View>
            ) : null}

            {tools.data?.products.length ? (
              <View style={styles.section}>
                <Text variant="heading">Tools you need</Text>
                <Text variant="small">
                  {tools.data.chosen
                    ? "Chosen by the trainer, from the marketplace."
                    : "From the marketplace, matching this course's list of tools."}
                </Text>
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={{ gap: space.md, paddingVertical: space.md }}
                >
                  {tools.data.products.map((product) => (
                    <ProductCard
                      key={product.id}
                      product={product}
                      width={150}
                      onPress={() => router.push(`/product/${product.id}`)}
                    />
                  ))}
                </ScrollView>
              </View>
            ) : null}

            {data.programmes.length ? (
              <Pressable
                onPress={() => router.push(`/workshop/${area}/${slug}`)}
                style={[styles.card, styles.inPerson]}
                accessibilityRole="link"
              >
                <MapPin size={24} color={colors.brand} />
                <View style={{ flex: 1 }}>
                  <Text variant="heading">Learn it in person</Text>
                  <Text variant="small">
                    {data.programmes[0].title} at the workshop, from {cedis(data.programmes[0].fee)}
                  </Text>
                </View>
              </Pressable>
            ) : null}
          </>
        )}
      </ScrollView>
    </View>
  );
}

function canStream(lesson: Lesson, access: CourseAccess | undefined) {
  if (!access || lesson.kind !== "upload") return false;
  return Boolean(access.streams[lesson.id] || access.sources[lesson.id]?.length);
}

/**
 * What to play: the copy saved on the phone, else the stream that changes
 * sharpness with the signal, else the plain file. The token goes with it,
 * so a paid lesson's files open for the person who bought it.
 */
function sourceFor(lesson: Lesson, access: CourseAccess | undefined, local?: string): PlayerSource {
  if (local) return { uri: local };
  const stream = access?.streams[lesson.id];
  const files = [...(access?.sources[lesson.id] ?? [])].sort((a, b) => b.quality - a.quality);
  const uri = mediaUrl(stream ?? files[0]?.url) ?? "";
  const signedIn = token();
  return {
    uri,
    contentType: stream ? "hls" : "progressive",
    headers: signedIn ? { Authorization: `Bearer ${signedIn}` } : undefined,
    metadata: { title: lesson.title },
  };
}

function Player({
  lesson,
  source,
  startAt,
  report,
  onProgress,
  onEnd,
}: {
  lesson: Lesson;
  source: PlayerSource;
  startAt: number;
  report: boolean;
  onProgress: () => void;
  onEnd: () => void;
}) {
  const auth = useAuth();
  const lastSent = useRef(0);
  const player = useVideoPlayer(source, (p) => {
    p.timeUpdateEventInterval = PROGRESS_EVERY;
    if (startAt > 5) p.currentTime = startAt;
    p.play();
  });
  const { status } = useEvent(player, "statusChange", {
    status: player.status,
  });

  async function send(position: number, completed = false) {
    if (!report) return;
    try {
      await auth.ensureTrainee();
      await api.lessonProgress(lesson.id, Math.floor(position), completed);
      if (completed) onProgress();
    } catch {
      // Progress is a nicety: the next report catches up.
    }
  }

  useEventListener(player, "timeUpdate", ({ currentTime }) => {
    if (Math.abs(currentTime - lastSent.current) >= PROGRESS_EVERY) {
      lastSent.current = currentTime;
      void send(currentTime);
    }
  });
  useEventListener(player, "playToEnd", () => {
    void send(lesson.duration_seconds ?? player.duration, true);
    onEnd();
  });

  return (
    <View style={styles.video}>
      <VideoView
        player={player}
        style={StyleSheet.absoluteFill}
        nativeControls
        fullscreenOptions={{ enable: true }}
        allowsPictureInPicture={false}
        contentFit="contain"
      />
      {status === "error" ? (
        <View style={styles.videoError}>
          <Text style={{ color: "#fff", textAlign: "center" }}>
            This lesson did not play. Check your connection, or save it on Wi-Fi to watch later.
          </Text>
        </View>
      ) : null}
    </View>
  );
}

function LockedPoster({ poster, loading }: { poster: string | null; loading: boolean }) {
  return (
    <View style={styles.video}>
      {poster ? (
        <Image source={{ uri: mediaUrl(poster) ?? undefined }} style={StyleSheet.absoluteFill} contentFit="cover" />
      ) : null}
      {loading ? null : (
        <View style={styles.lockOverlay}>
          <View style={styles.lockBadge}>
            <Lock size={22} color="#fff" />
          </View>
          <Text style={{ color: "#fff", fontFamily: fonts.semibold }}>Unlock the course to watch</Text>
        </View>
      )}
    </View>
  );
}

function LessonRow({
  number,
  lesson,
  first,
  active,
  done,
  open,
  canSave,
  saved,
  saving,
  onPress,
  onSave,
  onUnsave,
}: {
  number: number;
  lesson: Lesson;
  first: boolean;
  active: boolean;
  done: boolean;
  open: boolean;
  canSave: boolean;
  saved: boolean;
  saving: number | undefined;
  onPress: () => void;
  onSave: () => void;
  onUnsave: () => void;
}) {
  const minutes = lesson.duration_seconds ? `${Math.max(1, Math.round(lesson.duration_seconds / 60))} min` : "";
  return (
    <View style={[styles.lesson, first ? null : styles.divider, active ? styles.lessonActive : null]}>
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityState={{ selected: active }}
        style={({ pressed }) => [styles.lessonMain, pressed ? { opacity: 0.7 } : null]}
      >
        <View style={[styles.number, done ? styles.numberDone : active ? styles.numberActive : null]}>
          {done ? (
            <CircleCheck size={18} color="#fff" />
          ) : active ? (
            <CirclePlay size={18} color="#fff" />
          ) : (
            <Text style={styles.numberText}>{number}</Text>
          )}
        </View>
        <View style={{ flex: 1 }}>
          <Text variant="label" numberOfLines={2} style={active ? { color: colors.brand } : null}>
            {lesson.title}
          </Text>
          <Text variant="small">
            {minutes}
            {saved ? " · On this phone" : ""}
          </Text>
        </View>
      </Pressable>
      {lesson.kind === "youtube" ? (
        <ExternalLink size={20} color={colors.mutedForeground} />
      ) : !open ? (
        <Lock size={18} color={colors.mutedForeground} />
      ) : saving !== undefined ? (
        <Text variant="label" style={{ color: colors.brand }}>
          {Math.round(saving * 100)}%
        </Text>
      ) : saved ? (
        <Pressable
          onPress={onUnsave}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel="Remove from this phone"
        >
          <Trash size={18} color={colors.mutedForeground} />
        </Pressable>
      ) : canSave ? (
        <Pressable onPress={onSave} hitSlop={10} accessibilityRole="button" accessibilityLabel="Save to watch offline">
          <CloudDownload size={20} color={colors.brand} />
        </Pressable>
      ) : null}
    </View>
  );
}

/** Lessons under their section headings, in course order. */
function groupBySection(lessons: Lesson[]): [string, Lesson[]][] {
  const groups: [string, Lesson[]][] = [];
  for (const lesson of lessons) {
    const heading = lesson.section ?? "";
    const last = groups[groups.length - 1];
    if (last && last[0] === heading) last[1].push(lesson);
    else groups.push([heading, [lesson]]);
  }
  return groups;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  video: {
    width: "100%",
    aspectRatio: 16 / 9,
    backgroundColor: "#000",
    overflow: "hidden",
  },
  videoError: {
    ...StyleSheet.absoluteFill,
    alignItems: "center",
    justifyContent: "center",
    padding: space.xl,
  },
  lockOverlay: {
    ...StyleSheet.absoluteFill,
    backgroundColor: "rgba(38,0,90,0.55)",
    alignItems: "center",
    justifyContent: "center",
    gap: space.sm,
  },
  lockBadge: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: "rgba(255,255,255,0.18)",
    alignItems: "center",
    justifyContent: "center",
  },
  head: { padding: space.lg },
  progress: {
    marginTop: space.md,
    flexDirection: "row",
    alignItems: "center",
    gap: space.md,
  },
  track: {
    flex: 1,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.muted,
    overflow: "hidden",
  },
  fill: { height: 8, borderRadius: 4, backgroundColor: colors.visit },
  card: {
    marginHorizontal: space.lg,
    marginBottom: space.lg,
    padding: space.lg,
    borderRadius: radius.lg,
    backgroundColor: colors.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    ...shadow.card,
  },
  certificate: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.md,
    backgroundColor: colors.warnBg,
  },
  buy: { gap: space.md, borderColor: colors.brandSoft },
  price: { fontFamily: fonts.extrabold, fontSize: 28, color: colors.brandDeep },
  was: {
    fontFamily: fonts.medium,
    fontSize: 16,
    color: colors.mutedForeground,
    textDecorationLine: "line-through",
  },
  section: { paddingHorizontal: space.lg, marginBottom: space.xl },
  sectionTitle: {
    color: colors.mutedForeground,
    marginBottom: space.sm,
    marginLeft: 4,
  },
  list: {
    borderRadius: radius.lg,
    backgroundColor: colors.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    overflow: "hidden",
  },
  lesson: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.md,
    paddingRight: space.md,
    minHeight: 64,
  },
  lessonMain: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: space.md,
    padding: space.md,
  },
  lessonActive: { backgroundColor: colors.brandSoft },
  divider: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  number: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: colors.muted,
    alignItems: "center",
    justifyContent: "center",
  },
  numberDone: { backgroundColor: colors.visit },
  numberActive: { backgroundColor: colors.brand },
  numberText: {
    fontFamily: fonts.bold,
    fontSize: 13,
    color: colors.foreground,
  },
  bullet: { flexDirection: "row", gap: space.sm, alignItems: "flex-start" },
  inPerson: { flexDirection: "row", alignItems: "center", gap: space.md },
});
