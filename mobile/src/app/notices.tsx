import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { router } from "expo-router";
import { Bell } from "lucide-react-native";
import { useEffect } from "react";
import { FlatList, Pressable, RefreshControl, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { StackHeader } from "@/components/StackHeader";
import { EmptyState, ErrorState, Skeleton } from "@/components/States";
import { Text } from "@/components/Text";
import { useAuth } from "@/lib/auth";
import { shortDate } from "@/lib/format";
import { appPath } from "@/lib/links";
import { fetchNotices, markRead } from "@/lib/notices";
import { colors, fonts, space } from "@/theme/tokens";

/** Everything the app has been told: orders, messages, alerts. Newest first;
    opening the list marks them read. */
export default function NoticesScreen() {
  const insets = useSafeAreaInsets();
  const auth = useAuth();
  const client = useQueryClient();
  const notices = useQuery({ queryKey: ["notices"], queryFn: fetchNotices, enabled: auth.signedIn });
  const read = useMutation({
    mutationFn: () => markRead("all"),
    onSuccess: () => void client.invalidateQueries({ queryKey: ["notices"] }),
  });

  const unread = notices.data?.unread ?? 0;
  useEffect(() => {
    if (unread) read.mutate();
    // Once per visit with something unread.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unread]);

  return (
    <View style={styles.screen}>
      <StackHeader eyebrow="YOUR ACCOUNT" title="Notifications" />
      {!auth.signedIn ? (
        <EmptyState title="Sign in to get notifications" body="Orders, messages and alerts arrive here once you sign in." />
      ) : notices.isPending ? (
        <View style={{ padding: space.lg, gap: space.md }}>
          <Skeleton style={{ height: 64 }} />
          <Skeleton style={{ height: 64 }} />
        </View>
      ) : notices.isError ? (
        <ErrorState message="Your notifications did not load." onRetry={() => void notices.refetch()} />
      ) : (
        <FlatList
          data={notices.data.results}
          keyExtractor={(notice) => String(notice.id)}
          contentContainerStyle={{ paddingBottom: insets.bottom + space.xl }}
          refreshControl={
            <RefreshControl refreshing={notices.isRefetching} onRefresh={() => void notices.refetch()} tintColor={colors.brand} />
          }
          ListEmptyComponent={
            <View style={{ paddingTop: space.lg }}>
              <EmptyState title="Nothing yet" body="When an order moves, a seller replies or something you wait for is back, it shows here." />
            </View>
          }
          renderItem={({ item }) => (
            <Pressable
              onPress={() => item.link && router.push(appPath(item.link) as never)}
              disabled={!item.link}
              style={({ pressed }) => [styles.row, pressed ? { backgroundColor: colors.muted } : null]}
              accessibilityRole={item.link ? "link" : "text"}
            >
              <View style={styles.icon}>
                <Bell size={18} color={colors.brand} />
              </View>
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={[styles.body, item.read ? null : { fontFamily: fonts.bold }]}>{item.body}</Text>
                <Text variant="small">{shortDate(item.created_at)}</Text>
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
    alignItems: "flex-start",
    gap: space.md,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  icon: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center", backgroundColor: colors.brandSoft },
  body: { fontFamily: fonts.medium, fontSize: 15, lineHeight: 21, color: colors.foreground },
});
