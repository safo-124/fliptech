import { useQuery } from "@tanstack/react-query";
import { router } from "expo-router";
import { FlatList, Pressable, RefreshControl, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { NotificationsBanner } from "@/components/NotificationAsk";
import { StackHeader } from "@/components/StackHeader";
import { EmptyState, ErrorState, Skeleton } from "@/components/States";
import { Text } from "@/components/Text";
import { api } from "@/lib/api";
import { shortDate } from "@/lib/format";
import { colors, fonts, radius, space } from "@/theme/tokens";

/** Chats with sellers, newest first, unread in bold with a count. */
export default function ChatsScreen() {
  const insets = useSafeAreaInsets();
  const chats = useQuery({ queryKey: ["chats"], queryFn: api.chats, refetchInterval: 15000 });

  return (
    <View style={styles.screen}>
      <StackHeader eyebrow="MARKETPLACE" title="Messages" />
      <NotificationsBanner />
      {chats.isPending ? (
        <View style={{ padding: space.lg, gap: space.md }}>
          <Skeleton style={{ height: 64 }} />
          <Skeleton style={{ height: 64 }} />
        </View>
      ) : chats.isError ? (
        <ErrorState message="Your messages did not load." onRetry={() => void chats.refetch()} />
      ) : (
        <FlatList
          data={chats.data.results}
          keyExtractor={(chat) => String(chat.id)}
          contentContainerStyle={{ paddingBottom: insets.bottom + space.xl }}
          refreshControl={
            <RefreshControl refreshing={chats.isRefetching} onRefresh={() => void chats.refetch()} tintColor={colors.brand} />
          }
          ListEmptyComponent={
            <View style={{ paddingTop: space.lg }}>
              <EmptyState title="No messages yet" body="Message a seller from any product or shop and the chat shows here." />
            </View>
          }
          renderItem={({ item }) => (
            <Pressable
              onPress={() => router.push({ pathname: "/chats/[id]", params: { id: String(item.id) } })}
              style={({ pressed }) => [styles.row, pressed ? { backgroundColor: colors.muted } : null]}
              accessibilityRole="button"
            >
              <View style={styles.avatar}>
                <Text style={styles.initial}>{item.with.name.slice(0, 1).toUpperCase()}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.name, item.unread ? { fontFamily: fonts.extrabold } : null]} numberOfLines={1}>
                  {item.with.name}
                </Text>
                <Text variant="small" numberOfLines={1}>
                  {item.last?.sender === "buyer" ? "You: " : ""}
                  {item.last?.body}
                </Text>
              </View>
              <View style={{ alignItems: "flex-end", gap: 4 }}>
                <Text variant="small">{shortDate(item.last_message_at)}</Text>
                {item.unread ? (
                  <View style={styles.dot}>
                    <Text style={styles.dotText}>{String(item.unread)}</Text>
                  </View>
                ) : null}
              </View>
            </Pressable>
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
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  avatar: {
    width: 46,
    height: 46,
    borderRadius: 23,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.brandSoft,
  },
  initial: { fontFamily: fonts.extrabold, fontSize: 18, color: colors.brand },
  name: { fontFamily: fonts.semibold, fontSize: 15, color: colors.foreground },
  dot: {
    minWidth: 20,
    height: 20,
    borderRadius: radius.pill,
    paddingHorizontal: 6,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.brand,
  },
  dotText: { fontFamily: fonts.bold, fontSize: 11, color: "#ffffff" },
});
