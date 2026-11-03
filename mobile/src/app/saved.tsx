import { useMutation, useQuery } from "@tanstack/react-query";
import { router } from "expo-router";
import { Bell, Heart } from "lucide-react-native";
import { ScrollView, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ProductCard } from "@/components/Cards";
import { Button } from "@/components/Form";
import { StackHeader } from "@/components/StackHeader";
import { EmptyState, Skeleton } from "@/components/States";
import { Text } from "@/components/Text";
import { api, postJson } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useSaved } from "@/lib/saved";
import type { ProductCard as Product } from "@/lib/types";
import { colors, space } from "@/theme/tokens";

/** Favorites: everything with a heart, newest first. A sold-out one offers
    "Tell me when it's back". The same list as on the website when signed in. */
export default function SavedScreen() {
  const insets = useSafeAreaInsets();
  const saved = useSaved();
  const key = saved.ids.join(",");
  const products = useQuery({
    queryKey: ["saved-products", key],
    queryFn: () => api.products({ ids: key }),
    enabled: Boolean(key),
  });
  const byId = new Map((products.data?.results ?? []).map((product) => [product.id, product]));
  const items = saved.ids.flatMap((id) => byId.get(id) ?? []);
  const rows = Array.from({ length: Math.ceil(items.length / 2) }, (_, n) => items.slice(n * 2, n * 2 + 2));

  return (
    <View style={styles.screen}>
      <StackHeader eyebrow="MARKETPLACE" title="Saved" />
      <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.md, paddingBottom: insets.bottom + space.xl }}>
        {!key ? (
          <View style={{ gap: space.md }}>
            <EmptyState title="Nothing saved yet" body="Tap the heart on anything in the shop to keep it here." />
            <Button label="Go to the shop" onPress={() => router.navigate("/shop")} />
          </View>
        ) : products.isPending ? (
          <Skeleton style={{ height: 240 }} />
        ) : (
          rows.map((pair) => (
            <View key={pair[0].id} style={styles.row}>
              {pair.map((product) => (
                <View key={product.id} style={{ flex: 1, gap: space.sm }}>
                  <ProductCard product={product} onPress={() => router.push(`/product/${product.id}`)} />
                  {product.availability === "sold_out" ? <BackInStock product={product} /> : null}
                </View>
              ))}
              {pair.length === 1 ? <View style={{ flex: 1 }} /> : null}
            </View>
          ))
        )}
        {key ? (
          <Text variant="small" style={{ textAlign: "center" }}>
            <Heart size={12} color={colors.brandPink} /> We text you when something you saved gets cheaper.
          </Text>
        ) : null}
      </ScrollView>
    </View>
  );
}

function BackInStock({ product }: { product: Product }) {
  const auth = useAuth();
  const ask = useMutation({
    mutationFn: () => postJson(`/api/products/${product.id}/notify/`, { phone: auth.account?.phone }),
  });
  if (ask.isSuccess) return <Text variant="small">We will text you when it is back.</Text>;
  return (
    <Button
      label="Tell me when it's back"
      tone="soft"
      icon={<Bell size={14} color={colors.brand} />}
      busy={ask.isPending}
      onPress={() =>
        auth.signedIn
          ? ask.mutate()
          : router.push({ pathname: "/sign-in", params: { why: "to be told when it is back" } })
      }
      style={{ minHeight: 40 }}
    />
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  row: { flexDirection: "row", gap: space.md },
});
