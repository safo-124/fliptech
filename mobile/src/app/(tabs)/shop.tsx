import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { StyleSheet, View } from "react-native";

import { ProductCard } from "@/components/Cards";
import { PageHeader } from "@/components/PageHeader";
import { Screen } from "@/components/Screen";
import { EmptyState, ErrorState, Skeleton } from "@/components/States";
import { Text } from "@/components/Text";
import { api } from "@/lib/api";
import { openOnSite } from "@/lib/open";
import { space } from "@/theme/tokens";

/** Shop: the marketplace, two products to a row. */
export default function ShopScreen() {
  const [q, setQ] = useState("");
  const products = useQuery({ queryKey: ["products", q], queryFn: () => api.products({ q }) });
  const items = products.data?.results ?? [];
  const rows = Array.from({ length: Math.ceil(items.length / 2) }, (_, n) => items.slice(n * 2, n * 2 + 2));

  return (
    <Screen refreshing={products.isRefetching} onRefresh={() => void products.refetch()}>
      <PageHeader
        eyebrow="MARKETPLACE"
        title="Tools and goods"
        placeholder="Search the marketplace"
        onSearch={setQ}
      />
      <View style={styles.list}>
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
              {products.data?.count} {products.data?.count === 1 ? "product" : "products"}
            </Text>
            {rows.map((pair) => (
              <View key={pair[0].id} style={styles.row}>
                {pair.map((product) => (
                  <ProductCard
                    key={product.id}
                    product={product}
                    onPress={() => void openOnSite(`/marketplace/${product.id}`)}
                  />
                ))}
                {pair.length === 1 ? <View style={{ flex: 1 }} /> : null}
              </View>
            ))}
          </>
        ) : (
          <EmptyState title="Nothing found" body="Try another word." />
        )}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  list: { marginTop: space.xl, gap: space.md },
  row: { flexDirection: "row", gap: space.md, paddingHorizontal: space.lg },
  cell: { flex: 1, height: 240 },
});
