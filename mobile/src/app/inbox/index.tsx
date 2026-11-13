import { useQuery } from "@tanstack/react-query";
import { router } from "expo-router";
import { GraduationCap, Store } from "lucide-react-native";
import { FlatList, Pressable, RefreshControl, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { NotificationsBanner } from "@/components/NotificationAsk";
import { StackHeader } from "@/components/StackHeader";
import { EmptyState, ErrorState, Skeleton } from "@/components/States";
import { Text } from "@/components/Text";
import { api, ApiError } from "@/lib/api";
import { shortDate } from "@/lib/format";
import type { ChatSummary } from "@/lib/types";
import { colors, fonts, radius, space } from "@/theme/tokens";

function preview(chat: ChatSummary) {
  const last = chat.last;
  if (!last) return "";
  const mine = last.sender === "seller";
  if (last.kind === "phone") return mine ? "You shared your number" : "Shared their number";
  const text = last.kind === "enquiry" && last.course ? `Enquiry: ${last.course.title}` : last.body;
  return mine ? `You: ${text}` : text;
}

/**
 * Business messages: every chat for the shop and the workshop this login
 * holds, newest first, unread in bold with a count. One list for somebody
 * who teaches and sells. The texts and notices about a message open here.
 */
export default function InboxScreen() {
  const insets = useSafeAreaInsets();
  const chats = useQuery({ queryKey: ["inbox"], queryFn: api.inbox, refetchInterval: 15000 });
  const results = chats.data?.results ?? [];
  // Which shop or workshop a chat is with matters only to someone who has both.
  const mixed = new Set(results.map((chat) => `${chat.business?.kind}${chat.business?.id}`)).size > 1;
  const refused = chats.error instanceof ApiError && (chats.error.status === 401 || chats.error.status === 403);

  return (
    <View style={styles.screen}>
      <StackHeader eyebrow="YOUR SHOP AND WORKSHOP" title="Business messages" />
      <NotificationsBanner battery />
      {chats.isPending ? (
        <View style={{ padding: space.lg, gap: space.md }}>
          <Skeleton style={{ height: 64 }} />
          <Skeleton style={{ height: 64 }} />
        </View>
      ) : refused ? (
        <EmptyState
          title="For shops and workshops"
          body="These messages are for people who sell or teach on Fliiptech. Your own chats are in Me, then Messages."
        />
      ) : chats.isError ? (
        <ErrorState message="Your messages did not load." onRetry={() => void chats.refetch()} />
      ) : (
        <FlatList
          data={results}
          keyExtractor={(chat) => String(chat.id)}
          contentContainerStyle={{ paddingBottom: insets.bottom + space.xl }}
          refreshControl={
            <RefreshControl refreshing={chats.isRefetching} onRefresh={() => void chats.refetch()} tintColor={colors.brand} />
          }
          ListHeaderComponent={
            <Text variant="small" style={styles.lead}>
              People asking about your courses and products. Your number stays hidden unless you share it.
            </Text>
          }
          ListEmptyComponent={
            <View style={{ paddingTop: space.lg }}>
              <EmptyState
                title="No messages yet"
                body="When someone asks about one of your courses or products, the chat shows here."
              />
            </View>
          }
          renderItem={({ item }) => (
            <Pressable
              onPress={() => router.push({ pathname: "/inbox/[id]", params: { id: String(item.id) } })}
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
                {mixed && item.business ? (
                  <View style={styles.business}>
                    {item.business.kind === "workshop" ? (
                      <GraduationCap size={12} color={colors.mutedForeground} />
                    ) : (
                      <Store size={12} color={colors.mutedForeground} />
                    )}
                    <Text variant="small" numberOfLines={1}>
                      {item.business.name}
                    </Text>
                  </View>
                ) : null}
                <Text variant="small" numberOfLines={1}>
                  {preview(item)}
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
  lead: { paddingHorizontal: space.lg, paddingVertical: space.sm },
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
  business: { flexDirection: "row", alignItems: "center", gap: 4 },
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
