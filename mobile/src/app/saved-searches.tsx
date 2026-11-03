import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BellRing, Trash2 } from "lucide-react-native";
import { FlatList, Pressable, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { StackHeader } from "@/components/StackHeader";
import { EmptyState, ErrorState, Skeleton } from "@/components/States";
import { Text } from "@/components/Text";
import { api } from "@/lib/api";
import { openOnSite } from "@/lib/open";
import { colors, radius, space } from "@/theme/tokens";

/** Searches kept on the account; each is texted about new matches. */
export default function SavedSearchesScreen() {
  const insets = useSafeAreaInsets();
  const client = useQueryClient();
  const searches = useQuery({ queryKey: ["saved-searches"], queryFn: api.savedSearches });
  const remove = useMutation({
    mutationFn: api.deleteSearch,
    onSuccess: () => void client.invalidateQueries({ queryKey: ["saved-searches"] }),
  });

  return (
    <View style={styles.screen}>
      <StackHeader eyebrow="MARKETPLACE" title="Saved searches" />
      {searches.isPending ? (
        <View style={{ padding: space.lg }}>
          <Skeleton style={{ height: 64 }} />
        </View>
      ) : searches.isError ? (
        <ErrorState message="Your saved searches did not load." onRetry={() => void searches.refetch()} />
      ) : (
        <FlatList
          data={searches.data.results}
          keyExtractor={(search) => String(search.id)}
          contentContainerStyle={{ padding: space.lg, gap: space.md, paddingBottom: insets.bottom + space.xl }}
          ListEmptyComponent={
            <EmptyState
              title="No saved searches"
              body={'In the shop, search or filter, then tap "Text me new matches". We text you when something new matches.'}
            />
          }
          renderItem={({ item }) => (
            <View style={styles.row}>
              <BellRing size={18} color={colors.brand} />
              <Pressable style={{ flex: 1 }} onPress={() => void openOnSite(item.path)} accessibilityRole="link">
                <Text variant="label" numberOfLines={1}>
                  {item.label}
                </Text>
                <Text variant="small" numberOfLines={1}>
                  {Object.values(item.params).join(" · ")}
                </Text>
              </Pressable>
              <Pressable
                onPress={() => remove.mutate(item.id)}
                hitSlop={10}
                accessibilityRole="button"
                accessibilityLabel={`Stop texting me about ${item.label}`}
              >
                <Trash2 size={18} color={colors.mutedForeground} />
              </Pressable>
            </View>
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.md,
    padding: space.lg,
    borderRadius: radius.lg,
    backgroundColor: colors.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
});
