import { Heart as HeartIcon } from "lucide-react-native";
import { Pressable, StyleSheet } from "react-native";
import Animated, { useAnimatedStyle, useSharedValue, withSequence, withSpring } from "react-native-reanimated";

import { useSaved } from "@/lib/saved";
import { colors, shadow } from "@/theme/tokens";

/** Save for later: a heart that fills, on cards and product pages. */
export function Heart({ productId, size = 36 }: { productId: number; size?: number }) {
  const saved = useSaved();
  const on = saved.has(productId);
  const scale = useSharedValue(1);
  const bounce = useAnimatedStyle(() => ({ transform: [{ scale: scale.get() }] }));
  return (
    <Pressable
      onPress={() => {
        saved.toggle(productId);
        scale.set(withSequence(withSpring(1.3), withSpring(1)));
      }}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityState={{ selected: on }}
      accessibilityLabel={on ? "Saved. Remove from saved" : "Save for later"}
      style={[styles.button, { width: size, height: size, borderRadius: size / 2 }]}
    >
      <Animated.View style={bounce}>
        <HeartIcon size={size * 0.5} color={on ? colors.brandPink : colors.foreground} fill={on ? colors.brandPink : "transparent"} />
      </Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.92)",
    ...shadow.card,
  },
});
