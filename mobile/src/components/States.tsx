import { RefreshCw, WifiOff } from "lucide-react-native";
import { useEffect } from "react";
import { Pressable, StyleSheet, View, type ViewStyle } from "react-native";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";

import { colors, fonts, radius, space } from "@/theme/tokens";

import { Text } from "./Text";

/** A grey block that breathes while something loads. */
export function Skeleton({ style }: { style?: ViewStyle }) {
  const opacity = useSharedValue(0.55);
  useEffect(() => {
    opacity.set(withRepeat(withTiming(1, { duration: 750 }), -1, true));
  }, [opacity]);
  const animated = useAnimatedStyle(() => ({ opacity: opacity.get() }));
  return <Animated.View style={[styles.skeleton, style, animated]} />;
}

/** What went wrong, in words, and a way to try again. */
export function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <View style={styles.box}>
      <WifiOff size={28} color={colors.mutedForeground} />
      <Text variant="small" style={styles.center}>
        {message}
      </Text>
      <Pressable onPress={onRetry} style={styles.retry} accessibilityRole="button">
        <RefreshCw size={16} color={colors.brand} />
        <Text style={styles.retryText}>Try again</Text>
      </Pressable>
    </View>
  );
}

export function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <View style={styles.box}>
      <Text variant="heading">{title}</Text>
      <Text variant="small" style={styles.center}>
        {body}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  skeleton: { backgroundColor: colors.muted, borderRadius: radius.md },
  box: {
    marginHorizontal: space.lg,
    padding: space.xl,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: colors.borderStrong,
    alignItems: "center",
    gap: space.sm,
  },
  center: { textAlign: "center" },
  retry: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: space.xs,
    paddingHorizontal: space.lg,
    minHeight: 44,
    borderRadius: radius.pill,
    backgroundColor: colors.brandSoft,
  },
  retryText: { fontFamily: fonts.bold, color: colors.brand, fontSize: 14 },
});
