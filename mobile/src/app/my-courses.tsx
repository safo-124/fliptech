import { useQuery } from "@tanstack/react-query";
import { Image } from "expo-image";
import { router } from "expo-router";
import { Award, CirclePlay } from "lucide-react-native";
import { FlatList, Pressable, RefreshControl, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Button } from "@/components/Form";
import { StackHeader } from "@/components/StackHeader";
import { EmptyState, ErrorState, Skeleton } from "@/components/States";
import { Text } from "@/components/Text";
import { api } from "@/lib/api";
import { mediaUrl } from "@/lib/media";
import type { MyCourse } from "@/lib/types";
import { colors, fonts, radius, shadow, space } from "@/theme/tokens";

/** Every course started or bought, latest first, each with "carry on". */
export default function MyCoursesScreen() {
  const insets = useSafeAreaInsets();
  const mine = useQuery({ queryKey: ["my-courses"], queryFn: api.myCourses });

  return (
    <View style={styles.screen}>
      <StackHeader eyebrow="LEARN" title="My courses" />
      {mine.isPending ? (
        <View style={{ padding: space.lg, gap: space.md }}>
          <Skeleton style={{ height: 110 }} />
          <Skeleton style={{ height: 110 }} />
        </View>
      ) : mine.isError ? (
        <ErrorState message="Your courses did not load." onRetry={() => void mine.refetch()} />
      ) : (
        <FlatList
          data={mine.data.results}
          keyExtractor={(row) => String(row.course.id)}
          contentContainerStyle={{ padding: space.lg, gap: space.md, paddingBottom: insets.bottom + space.xl }}
          refreshControl={
            <RefreshControl refreshing={mine.isRefetching} onRefresh={() => void mine.refetch()} tintColor={colors.brand} />
          }
          ListEmptyComponent={
            <View style={{ gap: space.lg }}>
              <EmptyState title="No courses yet" body="Start a free course and it shows here, with your place kept." />
              <Button label="Find a course" onPress={() => router.navigate("/learn")} />
            </View>
          }
          renderItem={({ item }) => <MyCourseCard row={item} />}
        />
      )}
    </View>
  );
}

function MyCourseCard({ row }: { row: MyCourse }) {
  const share = row.total ? row.done / row.total : 0;
  const finished = row.total > 0 && row.done === row.total;
  return (
    <Pressable
      onPress={() =>
        router.push({
          pathname: "/course/[area]/[slug]",
          params: {
            area: row.course.area_slug,
            slug: row.course.slug,
            ...(row.resume ? { lesson: String(row.resume.id) } : {}),
          },
        })
      }
      style={({ pressed }) => [styles.card, pressed ? { opacity: 0.85 } : null]}
      accessibilityRole="button"
    >
      <View style={styles.poster}>
        {row.course.poster ? (
          <Image source={{ uri: mediaUrl(row.course.poster) ?? undefined }} style={StyleSheet.absoluteFill} contentFit="cover" />
        ) : null}
      </View>
      <View style={{ flex: 1, gap: 4 }}>
        <Text variant="heading" numberOfLines={2}>
          {row.course.name}
        </Text>
        <Text variant="small" numberOfLines={1}>
          {finished ? "Finished" : row.resume ? `Next: ${row.resume.title}` : `${row.total} lessons`}
        </Text>
        <View style={styles.track}>
          <View style={[styles.fill, { width: `${share * 100}%` }, finished ? { backgroundColor: colors.visit } : null]} />
        </View>
        <View style={styles.foot}>
          <Text variant="label">
            {row.done}/{row.total}
          </Text>
          {row.certificate ? (
            <View style={styles.pill}>
              <Award size={14} color={colors.warn} />
              <Text style={styles.pillText}>Certificate</Text>
            </View>
          ) : (
            <View style={[styles.pill, { backgroundColor: colors.brandSoft }]}>
              <CirclePlay size={14} color={colors.brand} />
              <Text style={[styles.pillText, { color: colors.brand }]}>{row.done ? "Carry on" : "Start"}</Text>
            </View>
          )}
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  card: {
    flexDirection: "row",
    gap: space.md,
    padding: space.md,
    borderRadius: radius.lg,
    backgroundColor: colors.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    ...shadow.card,
  },
  poster: { width: 96, height: 96, borderRadius: radius.md, overflow: "hidden", backgroundColor: colors.brandSoft },
  track: { height: 6, borderRadius: 3, backgroundColor: colors.muted, overflow: "hidden", marginTop: 4 },
  fill: { height: 6, borderRadius: 3, backgroundColor: colors.brand },
  foot: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 2 },
  pill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: space.sm,
    paddingVertical: 3,
    borderRadius: radius.pill,
    backgroundColor: colors.warnBg,
  },
  pillText: { fontFamily: fonts.semibold, fontSize: 12, color: colors.warn },
});
