import { useQuery } from "@tanstack/react-query";
import { router } from "expo-router";
import { View } from "react-native";

import { CourseCard, ProductCard, WorkshopRow } from "@/components/Cards";
import { Hero } from "@/components/Hero";
import { Screen } from "@/components/Screen";
import { Section, Shelf } from "@/components/Section";
import { EmptyState, ErrorState, Skeleton } from "@/components/States";
import { api } from "@/lib/api";
import { space } from "@/theme/tokens";

/** Home: one message, then a window onto each part of the app. */
export default function HomeScreen() {
  const courses = useQuery({ queryKey: ["courses", "home"], queryFn: () => api.courses() });
  const workshops = useQuery({ queryKey: ["providers", "home"], queryFn: () => api.providers() });
  const products = useQuery({ queryKey: ["products", "home"], queryFn: () => api.products() });
  const refreshing = courses.isRefetching || workshops.isRefetching || products.isRefetching;

  return (
    <Screen
      edgeToEdgeTop
      refreshing={refreshing}
      onRefresh={() => {
        void courses.refetch();
        void workshops.refetch();
        void products.refetch();
      }}
    >
      <Hero
        eyebrow="FLIIPTECH SKILLS HUB"
        title={"Learn a trade.\nGet ahead."}
        body="Lessons filmed in real Ghanaian workshops, training near you, and tools from the people who use them."
        action="Explore courses"
        onAction={() => router.navigate("/learn")}
        onMap={() => router.push("/map")}
      />

      <Section title="Top" accent="courses" action="See all" onAction={() => router.navigate("/learn")}>
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
            {courses.data.results.slice(0, 8).map((course) => (
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

      <Section title="Learn" accent="in person" action="See all" onAction={() => router.navigate("/explore")}>
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

      <Section title="From the" accent="marketplace" action="Shop" onAction={() => router.navigate("/shop")}>
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
    </Screen>
  );
}
