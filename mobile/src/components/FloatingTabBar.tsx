import type { BottomTabBarProps } from "expo-router/tabs";
import { CirclePlay, CircleUserRound, Compass, House, ShoppingBag, type LucideIcon } from "lucide-react-native";
import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import { Pressable, StyleSheet, Text, View, type LayoutChangeEvent } from "react-native";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
  type SharedValue,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { colors, fonts, radius, shadow } from "@/theme/tokens";

/** The bar's own height, without the gap under it. */
export const TAB_BAR_HEIGHT = 64;
const SIDE_GAP = 16;
const BOTTOM_GAP = 10;

/** Each tab's icon, by route name. The words come from each screen's title. */
const ICONS: Record<string, LucideIcon> = {
  index: House,
  explore: Compass,
  learn: CirclePlay,
  shop: ShoppingBag,
  me: CircleUserRound,
};

// --------------------------------------------------------------------------
// Hiding on scroll

type Visibility = { hidden: SharedValue<number> };
const VisibilityContext = createContext<Visibility | null>(null);

/**
 * Lets a screen slide the bar away while the learner scrolls down, and
 * bring it back when they scroll up: more room for photos and video on a
 * small phone. Screens get it through components/Screen.tsx.
 */
export function TabBarVisibilityProvider({ children }: { children: ReactNode }) {
  const hidden = useSharedValue(0);
  const value = useMemo(() => ({ hidden }), [hidden]);
  return <VisibilityContext.Provider value={value}>{children}</VisibilityContext.Provider>;
}

export function useTabBarVisibility() {
  return useContext(VisibilityContext);
}

/** Space a scrolling screen leaves at its foot so the bar never covers it. */
export function useTabBarSpace() {
  const insets = useSafeAreaInsets();
  return TAB_BAR_HEIGHT + BOTTOM_GAP + insets.bottom + 16;
}

// --------------------------------------------------------------------------
// The bar

/**
 * The app's main navigation: a floating rounded bar, its five tabs as icons
 * with a word under each, and a soft purple bubble that slides to the
 * active one.
 *
 * Words as well as icons on purpose: many people here are new to
 * smartphones, and an icon alone is a guess. A badge (a dot or a number)
 * comes from a screen's `tabBarBadge` option.
 */
export function FloatingTabBar({ state, descriptors, emitter, navigateToTab }: BottomTabBarProps) {
  const insets = useSafeAreaInsets();
  const visibility = useTabBarVisibility();
  const [width, setWidth] = useState(0);
  const count = state.routes.length;
  const slot = width / Math.max(count, 1);

  const bubbleStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: withSpring(state.index * slot, { damping: 18, stiffness: 180 }) }],
    width: slot,
    opacity: slot ? 1 : 0,
  }));

  const barStyle = useAnimatedStyle(() => {
    const hidden = visibility?.hidden.get() ?? 0;
    return {
      transform: [{ translateY: withTiming(hidden ? TAB_BAR_HEIGHT + BOTTOM_GAP + insets.bottom + 20 : 0) }],
    };
  });

  return (
    <Animated.View
      pointerEvents="box-none"
      style={[styles.wrap, { bottom: BOTTOM_GAP + insets.bottom }, barStyle]}
    >
      <View
        accessibilityRole="tablist"
        style={styles.bar}
        onLayout={(event: LayoutChangeEvent) => setWidth(event.nativeEvent.layout.width - 12)}
      >
        <Animated.View pointerEvents="none" style={[styles.bubbleTrack, bubbleStyle]}>
          <View style={styles.bubble} />
        </Animated.View>

        {state.routes.map((route, index) => {
          const { options } = descriptors[route.key];
          const label = typeof options.title === "string" ? options.title : route.name;
          const focused = state.index === index;
          const Icon = ICONS[route.name] ?? House;
          const badge = options.tabBarBadge;

          function press() {
            const event = emitter.emit({ type: "tabPress", target: route.key, canPreventDefault: true });
            if (!focused && !event.defaultPrevented) navigateToTab(route.key);
          }

          return (
            <Pressable
              key={route.key}
              accessibilityRole="tab"
              accessibilityState={{ selected: focused }}
              accessibilityLabel={options.tabBarAccessibilityLabel ?? label}
              testID={`tab-${route.name}`}
              onPress={press}
              onLongPress={() => emitter.emit({ type: "tabLongPress", target: route.key })}
              style={styles.tab}
              android_ripple={{ color: colors.brandSoft, borderless: true, radius: 32 }}
            >
              <View>
                <Icon
                  size={24}
                  strokeWidth={focused ? 2.4 : 1.9}
                  color={focused ? colors.brand : colors.mutedForeground}
                />
                {badge !== undefined ? (
                  <View style={[styles.badge, badge === "" ? styles.dot : null]}>
                    {badge !== "" ? <Text style={styles.badgeText}>{String(badge)}</Text> : null}
                  </View>
                ) : null}
              </View>
              <Text
                numberOfLines={1}
                style={[styles.label, focused ? styles.labelActive : null]}
                maxFontSizeMultiplier={1.3}
              >
                {label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: "absolute",
    left: SIDE_GAP,
    right: SIDE_GAP,
  },
  bar: {
    height: TAB_BAR_HEIGHT,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 6,
    borderRadius: radius.pill,
    backgroundColor: colors.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    ...shadow.floating,
  },
  bubbleTrack: {
    position: "absolute",
    left: 6,
    top: 6,
    bottom: 6,
    paddingHorizontal: 4,
  },
  bubble: {
    flex: 1,
    borderRadius: radius.pill,
    backgroundColor: colors.brandSoft,
  },
  tab: {
    flex: 1,
    height: "100%",
    alignItems: "center",
    justifyContent: "center",
    gap: 3,
  },
  label: {
    fontFamily: fonts.medium,
    fontSize: 11,
    color: colors.mutedForeground,
  },
  labelActive: {
    fontFamily: fonts.bold,
    color: colors.brand,
  },
  badge: {
    position: "absolute",
    top: -4,
    right: -10,
    minWidth: 18,
    height: 18,
    paddingHorizontal: 4,
    borderRadius: 9,
    backgroundColor: colors.coral,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: colors.card,
  },
  dot: {
    minWidth: 12,
    width: 12,
    height: 12,
    top: -2,
    right: -4,
    paddingHorizontal: 0,
  },
  badgeText: {
    fontFamily: fonts.bold,
    fontSize: 10,
    color: "#ffffff",
  },
});
