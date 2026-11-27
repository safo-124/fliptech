import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { router } from "expo-router";
import { GraduationCap, LayoutGrid, SlidersHorizontal, Store, X } from "lucide-react-native";
import { useState } from "react";
import { ScrollView, StyleSheet, View } from "react-native";

import { BasketButton } from "@/components/BasketButton";
import { ProductCard } from "@/components/Cards";
import { CategoryRow } from "@/components/CategoryRow";
import { Button } from "@/components/Form";
import { Chip, FilterSheet } from "@/components/market/FilterSheet";
import { ShopList } from "@/components/market/ShopList";
import { SaveSearchButton } from "@/components/market/SaveSearchButton";
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

  // Items (every product) or Shops (every shop, trainers' first).
  const [view, setView] = useState<"items" | "shops">("items");
  const shops = useQuery({ queryKey: ["shops"], queryFn: api.shops, enabled: view === "shops" });

  const items = products.data?.pages.flatMap((page) => page.results) ?? [];
  const count = products.data?.pages[0]?.count ?? 0;
  const rows = Array.from({ length: Math.ceil(items.length / 2) }, (_, n) => items.slice(n * 2, n * 2 + 2));
  const on = activeCount(filters);

  const switcher = (
    <View style={styles.switch}>
      <Chip label="Items" on={view === "items"} onPress={() => setView("items")} icon={<LayoutGrid size={15} color={view === "items" ? "#ffffff" : colors.brand} />} />
      <Chip label="Shops" on={view === "shops"} onPress={() => setView("shops")} icon={<Store size={15} color={view === "shops" ? "#ffffff" : colors.brand} />} />
    </View>
  );

  if (view === "shops") {
    return (
      <Screen refreshing={shops.isRefetching} onRefresh={() => void shops.refetch()}>
        <PageHeader
          eyebrow="MARKETPLACE"
          title="Tools and goods"
          placeholder="Search the marketplace"
          onSearch={(q) => {
            setView("items");
            toggle({ q });
          }}
          action={<BasketButton />}
        />
        {switcher}
        <View style={styles.list}>
          {shops.isPending ? (
            <Skeleton style={{ height: 150, marginHorizontal: space.lg }} />
          ) : shops.isError ? (
            <ErrorState message={shops.error.message} onRetry={() => void shops.refetch()} />
          ) : (
            <ShopList shops={shops.data.results} />
          )}
        </View>
      </Screen>
    );
  }

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
        action={<BasketButton />}
      />
      {switcher}
      <CategoryRow list="shop" selected={filters.category} onSelect={(category) => toggle({ category })} />

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

        {!plain ? (
          <View style={{ paddingHorizontal: space.lg }}>
            <SaveSearchButton filters={filters} />
          </View>
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
  switch: { flexDirection: "row", gap: space.sm, paddingHorizontal: space.lg, marginTop: space.md },
  row: { flexDirection: "row", gap: space.md, paddingHorizontal: space.lg },
  cell: { flex: 1, height: 240 },
});
