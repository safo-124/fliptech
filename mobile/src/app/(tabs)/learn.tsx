import { useQuery } from "@tanstack/react-query";
import { router } from "expo-router";
import { useState } from "react";
import { View } from "react-native";

import { CourseCard } from "@/components/Cards";
import { PageHeader } from "@/components/PageHeader";
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
  const courses = useQuery({ queryKey: ["courses", q], queryFn: () => api.courses({ q }) });

  return (
    <Screen refreshing={courses.isRefetching} onRefresh={() => void courses.refetch()}>
      <PageHeader
        eyebrow="ONLINE LEARNING"
        title="Learn on your phone"
        placeholder="Search courses"
        onSearch={setQ}
      />
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
