import { router } from "expo-router";
import { ArrowLeft, Share2 } from "lucide-react-native";
import { Pressable, Share, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { colors, shadow, space } from "@/theme/tokens";

/** Round back (and share) buttons floating over a screen's top photo. */
export function BackBar({ share }: { share?: { message: string; url: string } }) {
  const insets = useSafeAreaInsets();
  return (
    <View pointerEvents="box-none" style={[styles.bar, { top: insets.top + space.sm }]}>
      <Pressable
        onPress={() => (router.canGoBack() ? router.back() : router.replace("/"))}
        accessibilityRole="button"
        accessibilityLabel="Back"
        hitSlop={8}
        style={styles.button}
      >
        <ArrowLeft size={22} color={colors.foreground} />
      </Pressable>
      {share ? (
        <Pressable
          onPress={() => void Share.share({ message: `${share.message} ${share.url}` })}
          accessibilityRole="button"
          accessibilityLabel="Share"
          hitSlop={8}
          style={styles.button}
        >
          <Share2 size={20} color={colors.foreground} />
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    position: "absolute",
    left: space.lg,
    right: space.lg,
    flexDirection: "row",
    justifyContent: "space-between",
    zIndex: 10,
  },
  button: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.94)",
    ...shadow.card,
  },
});
