import { useQuery } from "@tanstack/react-query";
import { router } from "expo-router";
import { useState } from "react";
import { View } from "react-native";

import { CourseCard } from "@/components/Cards";
import { CategoryRow } from "@/components/CategoryRow";
import { PageHeader } from "@/components/PageHeader";
import { SelectChip } from "@/components/PickerSheet";
import { Screen } from "@/components/Screen";
import { EmptyState, ErrorState, Skeleton } from "@/components/States";
import { Text } from "@/components/Text";
import { api } from "@/lib/api";
import { space } from "@/theme/tokens";

/**
 * Learn: online courses. The player, progress and offline lessons come
 * next; for now a course opens on the website inside the app.
 */
export default function LearnScreen() {
  const [q, setQ] = useState("");
  const [category, setCategory] = useState<string | undefined>(undefined);
  const [sort, setSort] = useState("");
  const courses = useQuery({
    queryKey: ["courses", q, category, sort],
    queryFn: () => api.courses({ q, category, sort: sort || undefined }),
  });

  return (
    <Screen refreshing={courses.isRefetching} onRefresh={() => void courses.refetch()}>
      <PageHeader
        eyebrow="ONLINE LEARNING"
        title="Learn on your phone"
        placeholder="Search courses"
        onSearch={setQ}
      />
      <CategoryRow list="courses" selected={category} onSelect={setCategory} />
      <View style={{ flexDirection: "row", paddingHorizontal: space.lg, paddingTop: space.md }}>
        <SelectChip
          label="Sort"
          title="Sort courses"
          options={[
            { value: "", label: "Recommended" },
            { value: "newest", label: "Newest" },
            { value: "popular", label: "Most watched" },
            { value: "rating", label: "Best rated" },
            { value: "free", label: "Free first" },
          ]}
          value={sort}
          onPick={setSort}
        />
      </View>
      <View style={{ marginTop: space.xl, gap: space.lg, paddingHorizontal: space.lg }}>
        {courses.isPending ? (
          [0, 1].map((n) => <Skeleton key={n} style={{ height: 280 }} />)
        ) : courses.isError ? (
          <ErrorState message={courses.error.message} onRetry={() => void courses.refetch()} />
        ) : courses.data.results.length ? (
          <>
            <Text variant="small">
              {courses.data.count} {courses.data.count === 1 ? "course" : "courses"}
            </Text>
            {courses.data.results.map((course) => (
              <CourseCard
                key={course.id}
                course={course}
                fill
                onPress={() => router.push(`/course/${course.area_slug}/${course.slug}`)}
              />
            ))}
          </>
        ) : (
          q.trim() ? (
            <EmptyState title="No courses found" body="Try another word, or see every course." />
          ) : (
            <EmptyState title="No courses yet" body="Workshops are filming their first lessons." />
          )
        )}
      </View>
    </Screen>
  );
}
