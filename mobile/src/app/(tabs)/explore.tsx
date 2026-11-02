import { useQuery } from "@tanstack/react-query";
import { router } from "expo-router";
import { useState } from "react";
import { View } from "react-native";

import { WorkshopRow } from "@/components/Cards";
import { MapButton } from "@/components/MapButton";
import { PageHeader } from "@/components/PageHeader";
import { Screen } from "@/components/Screen";
import { EmptyState, ErrorState, Skeleton } from "@/components/States";
import { Text } from "@/components/Text";
import { api } from "@/lib/api";
import { openOnSite } from "@/lib/open";
import { space } from "@/theme/tokens";

/** Explore: workshops that teach a trade in person, with fees and intakes. */
export default function ExploreScreen() {
  const [q, setQ] = useState("");
  const workshops = useQuery({ queryKey: ["providers", q], queryFn: () => api.providers({ q }) });

  return (
    <Screen refreshing={workshops.isRefetching} onRefresh={() => void workshops.refetch()}>
      <PageHeader
        eyebrow="FIND TRAINING"
        title="Learn in person"
        placeholder="Welding, tailoring, a town…"
        onSearch={setQ}
        action={<MapButton onPress={() => router.push("/map")} />}
      />
      <View style={{ marginTop: space.xl, gap: space.md }}>
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
                onPress={() => void openOnSite(`/${workshop.area_slug}/${workshop.slug}`)}
              />
            ))}
          </>
        ) : (
          <EmptyState title="No workshops found" body="Try another trade or town." />
        )}
      </View>
    </Screen>
  );
}
