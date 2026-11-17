import { router } from "expo-router";
import { CheckCircle2 } from "lucide-react-native";
import { useEffect, useState } from "react";
import { DeviceEventEmitter, Pressable, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Text } from "@/components/Text";
import { colors, fonts, radius, space } from "@/theme/tokens";

const EVENT = "fliiptech.basket-added";

/** "Added to your basket · View basket", without leaving the screen. */
export function showBasketToast(extra?: string) {
  DeviceEventEmitter.emit(EVENT, extra ?? "");
}

/** Mounted once, over every screen. */
export function BasketToast() {
  const insets = useSafeAreaInsets();
  const [shown, setShown] = useState<{ at: number; extra: string } | null>(null);

  useEffect(() => {
    const subscription = DeviceEventEmitter.addListener(EVENT, (extra: string) =>
      setShown({ at: Date.now(), extra }),
    );
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    if (!shown) return;
    const timer = setTimeout(() => setShown(null), 4000);
    return () => clearTimeout(timer);
  }, [shown]);

  if (!shown) return null;
  return (
    <View pointerEvents="box-none" style={[styles.wrap, { bottom: insets.bottom + 96 }]}>
      <View style={styles.toast} accessibilityLiveRegion="polite" accessibilityRole="alert">
        <CheckCircle2 size={20} color={colors.visit} />
        <View style={{ flex: 1 }}>
          <Text style={styles.text}>Added to your basket</Text>
          {shown.extra ? <Text style={styles.extra}>{shown.extra}</Text> : null}
        </View>
        <Pressable
          onPress={() => {
            setShown(null);
            router.push("/basket");
          }}
          accessibilityRole="button"
          style={styles.link}
          hitSlop={6}
        >
          <Text style={styles.linkText}>View basket</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: "absolute", left: space.lg, right: space.lg, alignItems: "center" },
  toast: {
    width: "100%",
    maxWidth: 420,
    flexDirection: "row",
    alignItems: "center",
    gap: space.md,
    paddingLeft: space.lg,
    paddingRight: space.sm,
    paddingVertical: space.xs,
    borderRadius: radius.lg,
    backgroundColor: colors.foreground,
  },
  text: { fontFamily: fonts.semibold, fontSize: 14, color: "#fff" },
  extra: { fontSize: 12, color: "#ffffffcc" },
  link: { minHeight: 44, justifyContent: "center", paddingHorizontal: space.sm },
  linkText: { fontFamily: fonts.bold, fontSize: 14, color: "#fff", textDecorationLine: "underline" },
});
