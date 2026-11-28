import { useQuery, useQueryClient } from "@tanstack/react-query";
import { router, useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { FlatList, Pressable, RefreshControl, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { NotificationsBanner } from "@/components/NotificationAsk";
import { StackHeader } from "@/components/StackHeader";
import { EmptyState, ErrorState, Skeleton } from "@/components/States";
import { Text } from "@/components/Text";
import { api } from "@/lib/api";
import { shortDate } from "@/lib/format";
import { firstTab, forTab, inOrder, ROLE_LABEL, topicOf, waitsOnYou, type Role } from "@/lib/messages";
import type { ChatSummary } from "@/lib/types";
import { useChatCounts } from "@/lib/use-chat-counts";
import { colors, fonts, radius, space } from "@/theme/tokens";

const EMPTY: Record<Role, { title: string; body: string }> = {
  buying: { title: "No chats yet", body: "Message a shop or a workshop from its page and the chat shows here." },
  selling: { title: "No messages from buyers yet", body: "When someone asks about one of your products, it shows here." },
  teaching: { title: "No messages from trainees yet", body: "When someone asks about your training, it shows here." },
};

/**
 * Every chat this login has, with a tab for each role it holds, the same as
 * the website's messages panel: Buying (your chats with shops and workshops),
 * Selling (your shop's) and Teaching (your workshop's). One role, no tabs.
 * It opens on the tab with people waiting for a reply (lib/messages.ts).
 */
export default function MessagesScreen() {
  const insets = useSafeAreaInsets();
  const client = useQueryClient();
  const roles = inOrder(useChatCounts());
  const [chosen, setChosen] = useState<Role | null>(null);
  const tab = chosen && roles.some((entry) => entry.role === chosen) ? chosen : firstTab(roles, null);
  const business = tab === "selling" || tab === "teaching";

  const buying = useQuery({ queryKey: ["chats"], queryFn: api.chats, enabled: tab === "buying", refetchInterval: 15000 });
  const inbox = useQuery({ queryKey: ["inbox"], queryFn: api.inbox, enabled: business, refetchInterval: 15000 });
  const source = business ? inbox : buying;
  const chats = tab && source.data ? forTab(source.data.results, tab) : [];
  const current = roles.find((entry) => entry.role === tab);

  // Back from a chat: the counts on the tabs, Me and Home catch up at once.
  useFocusEffect(
    useCallback(() => {
      void client.invalidateQueries({ queryKey: ["chat-counts"] });
    }, [client]),
  );

  function choose(role: Role) {
    setChosen(role);
  }

  function open(chat: ChatSummary) {
    if (business) router.push({ pathname: "/inbox/[id]", params: { id: String(chat.id) } });
    else router.push({ pathname: "/chats/[id]", params: { id: String(chat.id) } });
  }

  return (
    <View style={styles.screen}>
      <StackHeader eyebrow="CHATS" title="Messages" />
      <NotificationsBanner />

      {roles.length > 1 ? (
        <View style={styles.tabs} accessibilityRole="tablist">
          {roles.map((entry) => {
            const on = entry.role === tab;
            return (
              <Pressable
                key={entry.role}
                onPress={() => choose(entry.role)}
                accessibilityRole="tab"
                accessibilityState={{ selected: on }}
                accessibilityLabel={`${ROLE_LABEL[entry.role]}${entry.unread ? `, ${entry.unread} unread` : ""}`}
                style={[styles.tab, on ? styles.tabOn : null]}
              >
                <Text style={[styles.tabText, on ? styles.tabTextOn : null]}>{ROLE_LABEL[entry.role]}</Text>
                {entry.unread ? (
                  <View style={styles.tabCount}>
                    <Text style={styles.tabCountText}>{entry.unread > 99 ? "99+" : String(entry.unread)}</Text>
                  </View>
                ) : null}
              </Pressable>
            );
          })}
        </View>
      ) : null}

      {!tab ? (
        <View style={{ paddingTop: space.lg }}>
          <EmptyState title="No messages yet" body="Message a shop or a workshop from its page and the chat shows here." />
        </View>
      ) : source.isPending ? (
        <View style={{ padding: space.lg, gap: space.md }}>
          <Skeleton style={{ height: 64 }} />
          <Skeleton style={{ height: 64 }} />
        </View>
      ) : source.isError ? (
        <ErrorState message="Your messages did not load." onRetry={() => void source.refetch()} />
      ) : (
        <FlatList
          data={chats}
          keyExtractor={(chat) => String(chat.id)}
          contentContainerStyle={{ paddingBottom: insets.bottom + space.xl }}
          refreshControl={
            <RefreshControl refreshing={source.isRefetching} onRefresh={() => void source.refetch()} tintColor={colors.brand} />
          }
          ListHeaderComponent={
            business && current && current.waiting > 0 ? (
              <Text variant="small" style={styles.waiting}>
                {current.waiting} waiting for your reply
              </Text>
            ) : undefined
          }
          ListEmptyComponent={
            <View style={{ paddingTop: space.lg }}>
              <EmptyState title={EMPTY[tab].title} body={EMPTY[tab].body} />
            </View>
          }
          renderItem={({ item }) => {
            const topic = topicOf(item);
            const mine = item.last ? item.last.sender === (business ? "seller" : "buyer") : false;
            const bold = item.unread > 0 || waitsOnYou(item, tab);
            return (
              <Pressable
                onPress={() => open(item)}
                style={({ pressed }) => [styles.row, pressed ? { backgroundColor: colors.muted } : null]}
                accessibilityRole="button"
              >
                <View style={styles.avatar}>
                  <Text style={styles.initial}>{item.with.name.slice(0, 1).toUpperCase()}</Text>
                </View>
                <View style={{ flex: 1, gap: 2 }}>
                  <View style={styles.nameRow}>
                    <Text style={[styles.name, bold ? { fontFamily: fonts.extrabold } : null]} numberOfLines={1}>
                      {item.with.name}
                    </Text>
                    {topic ? (
                      <Text style={styles.topic} numberOfLines={1}>
                        {topic}
                      </Text>
                    ) : null}
                  </View>
                  <Text variant="small" numberOfLines={1}>
                    {mine ? "You: " : ""}
                    {item.last?.kind === "phone" ? "Shared a phone number" : item.last?.body}
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
            );
          }}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  tabs: {
    flexDirection: "row",
    gap: 4,
    marginHorizontal: space.lg,
    marginTop: space.sm,
    marginBottom: space.sm,
    padding: 4,
    borderRadius: radius.lg,
    backgroundColor: colors.muted,
  },
  tab: {
    flex: 1,
    minHeight: 40,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    borderRadius: radius.md,
  },
  tabOn: { backgroundColor: colors.card },
  tabText: { fontFamily: fonts.semibold, fontSize: 13, color: colors.mutedForeground },
  tabTextOn: { color: colors.foreground },
  tabCount: {
    minWidth: 18,
    height: 18,
    borderRadius: radius.pill,
    paddingHorizontal: 5,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.brandPink,
  },
  tabCountText: { fontFamily: fonts.bold, fontSize: 10, color: "#ffffff" },
  waiting: { paddingHorizontal: space.lg, paddingVertical: space.sm },
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
  nameRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  name: { flexShrink: 1, fontFamily: fonts.semibold, fontSize: 15, color: colors.foreground },
  topic: {
    flexShrink: 0,
    maxWidth: "45%",
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: radius.sm,
    overflow: "hidden",
    backgroundColor: colors.muted,
    fontFamily: fonts.semibold,
    fontSize: 11,
    color: colors.mutedForeground,
  },
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
