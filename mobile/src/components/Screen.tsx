import { useRef, type ReactNode } from "react";
import {
  RefreshControl,
  ScrollView,
  StyleSheet,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { colors } from "@/theme/tokens";

import { useTabBarSpace, useTabBarVisibility } from "./FloatingTabBar";

/**
 * A tab's scrolling page: room for the status bar at the top, room for the
 * floating bar at the foot, pull to refresh, and the bar sliding away while
 * scrolling down and back when scrolling up.
 */
export function Screen({
  children,
  refreshing = false,
  onRefresh,
  edgeToEdgeTop = false,
}: {
  children: ReactNode;
  refreshing?: boolean;
  onRefresh?: () => void;
  /** Let the first child (a hero) run under the status bar. */
  edgeToEdgeTop?: boolean;
}) {
  const insets = useSafeAreaInsets();
  const space = useTabBarSpace();
  const visibility = useTabBarVisibility();
  const last = useRef(0);

  function onScroll(event: NativeSyntheticEvent<NativeScrollEvent>) {
    const y = event.nativeEvent.contentOffset.y;
    const delta = y - last.current;
    last.current = y;
    if (!visibility) return;
    // Near the top it always shows; past that, it follows the direction.
    if (y < 40) visibility.hidden.set(0);
    else if (delta > 6) visibility.hidden.set(1);
    else if (delta < -6) visibility.hidden.set(0);
  }

  return (
    <ScrollView
      style={styles.page}
      contentContainerStyle={{ paddingTop: edgeToEdgeTop ? 0 : insets.top + 8, paddingBottom: space }}
      onScroll={onScroll}
      scrollEventThrottle={32}
      refreshControl={
        onRefresh ? (
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            colors={[colors.brand]}
            tintColor={colors.brand}
            progressViewOffset={insets.top}
          />
        ) : undefined
      }
    >
      {children}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.background },
});
