import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { router } from "expo-router";
import { GraduationCap, SlidersHorizontal, X } from "lucide-react-native";
import { useState } from "react";
import { ScrollView, StyleSheet, View } from "react-native";

import { BagButton } from "@/components/BagButton";
import { ProductCard } from "@/components/Cards";
import { Button } from "@/components/Form";
import { Chip, FilterSheet } from "@/components/market/FilterSheet";
import { TrainerShops } from "@/components/market/TrainerShops";
import { PageHeader } from "@/components/PageHeader";
import { Screen } from "@/components/Screen";
import { EmptyState, ErrorState, Skeleton } from "@/components/States";
import { Text } from "@/components/Text";
import { api } from "@/lib/api";
import { activeCount, queryParams, SWITCHES, type MarketFilters } from "@/lib/market";
import { colors, space } from "@/theme/tokens";

/**
 * Shop: the marketplace, two products to a row. Quick filters as chips, the
 * rest on a sheet, and the training workshops that also sell at the top.
 */
export default function ShopScreen() {
  const [filters, setFilters] = useState<MarketFilters>({});
  const [sheet, setSheet] = useState(false);
  const toggle = (change: Partial<MarketFilters>) => setFilters((now) => ({ ...now, ...change }));

  const products = useInfiniteQuery({
    queryKey: ["products", filters],
    queryFn: ({ pageParam }) => api.products(queryParams(filters, pageParam)),
    initialPageParam: 1,
    getNextPageParam: (last, all) => (last.next ? all.length + 1 : undefined),
  });
  const plain = !activeCount(filters) && !filters.q;
  const trainers = useQuery({ queryKey: ["trainer-shops"], queryFn: api.trainerShops, enabled: plain });

  const items = products.data?.pages.flatMap((page) => page.results) ?? [];
  const count = products.data?.pages[0]?.count ?? 0;
  const rows = Array.from({ length: Math.ceil(items.length / 2) }, (_, n) => items.slice(n * 2, n * 2 + 2));
  const on = activeCount(filters);

  return (
    <Screen
      refreshing={products.isRefetching && !products.isFetchingNextPage}
      onRefresh={() => {
        void products.refetch();
        if (plain) void trainers.refetch();
      }}
    >
      <PageHeader
        eyebrow="MARKETPLACE"
        title="Tools and goods"
        placeholder="Search the marketplace"
        onSearch={(q) => toggle({ q })}
        action={<BagButton />}
      />

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.chips}
        style={{ marginTop: space.md }}
      >
        <Chip
          label={on ? `Filters · ${on}` : "Filters"}
          on={on > 0}
          onPress={() => setSheet(true)}
          icon={<SlidersHorizontal size={15} color={on ? "#ffffff" : colors.brand} />}
        />
        {filters.seller ? (
          <Chip
            label={filters.seller.name}
            on
            onPress={() => toggle({ seller: undefined })}
            icon={<X size={14} color="#ffffff" />}
          />
        ) : null}
        <Chip
          label="Trainers"
          on={filters.sold_by === "trainers"}
          onPress={() => toggle({ sold_by: filters.sold_by === "trainers" ? undefined : "trainers" })}
          icon={<GraduationCap size={15} color={filters.sold_by === "trainers" ? "#ffffff" : colors.brand} />}
        />
        {SWITCHES.map(([key, label]) => (
          <Chip key={key} label={label} on={Boolean(filters[key])} onPress={() => toggle({ [key]: !filters[key] })} />
        ))}
      </ScrollView>

      <View style={styles.list}>
        {plain && trainers.data ? (
          <TrainerShops
            shops={trainers.data.results}
            onPick={(shop) => toggle({ seller: { id: shop.id, name: shop.business_name } })}
          />
        ) : null}

        {products.isPending ? (
          <View style={styles.row}>
            <Skeleton style={styles.cell} />
            <Skeleton style={styles.cell} />
          </View>
        ) : products.isError ? (
          <ErrorState message={products.error.message} onRetry={() => void products.refetch()} />
        ) : items.length ? (
          <>
            <Text variant="small" style={{ paddingHorizontal: space.lg }}>
              {count} {count === 1 ? "product" : "products"}
            </Text>
            {rows.map((pair) => (
              <View key={pair[0].id} style={styles.row}>
                {pair.map((product) => (
                  <ProductCard
                    key={product.id}
                    product={product}
                    onPress={() => router.push(`/product/${product.id}`)}
                  />
                ))}
                {pair.length === 1 ? <View style={{ flex: 1 }} /> : null}
              </View>
            ))}
            {products.hasNextPage ? (
              <View style={{ paddingHorizontal: space.lg }}>
                <Button
                  label="Show more"
                  tone="soft"
                  busy={products.isFetchingNextPage}
                  onPress={() => void products.fetchNextPage()}
                />
              </View>
            ) : null}
          </>
        ) : (
          <View style={{ gap: space.md }}>
            <EmptyState
              title="Nothing found"
              body={on || filters.q ? "Nothing matches these filters. Try fewer." : "Nothing for sale yet."}
            />
            {on || filters.q ? (
              <View style={{ paddingHorizontal: space.lg }}>
                <Button label="Clear filters" tone="soft" onPress={() => setFilters({})} />
              </View>
            ) : null}
          </View>
        )}
      </View>

      <FilterSheet visible={sheet} filters={filters} onApply={setFilters} onClose={() => setSheet(false)} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  chips: { paddingHorizontal: space.lg, gap: space.sm },
  list: { marginTop: space.xl, gap: space.md },
  row: { flexDirection: "row", gap: space.md, paddingHorizontal: space.lg },
  cell: { flex: 1, height: 240 },
});
