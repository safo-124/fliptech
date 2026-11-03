import { StyleSheet, Text, View } from "react-native";

import { tradeHex } from "@/theme/trades";
import { colors, fonts } from "@/theme/tokens";

/**
 * A workshop's pin: a drop in its trade's colour with a white dot, like the
 * website's. The chosen one grows and gets a dark ring.
 */
export function WorkshopPin({ colour, selected }: { colour: string | null | undefined; selected: boolean }) {
  const hex = tradeHex(colour).strong;
  const size = selected ? 40 : 32;
  return (
    <View style={[styles.pinWrap, { width: size, height: size + 6 }]}>
      <View
        style={[
          styles.drop,
          {
            width: size,
            height: size,
            borderRadius: size / 2,
            backgroundColor: hex,
            borderColor: selected ? colors.brandDeep : "#ffffff",
          },
        ]}
      >
        <View style={[styles.dot, { width: size * 0.32, height: size * 0.32, borderRadius: size }]} />
      </View>
      <View style={[styles.tip, { borderTopColor: selected ? colors.brandDeep : hex }]} />
    </View>
  );
}

/** Workshops too close to tell apart at this zoom: one bubble with the count. */
export function ClusterBubble({ count }: { count: number }) {
  const size = count >= 100 ? 54 : count >= 10 ? 46 : 40;
  return (
    <View style={[styles.halo, { width: size + 12, height: size + 12, borderRadius: (size + 12) / 2 }]}>
      <View style={[styles.bubble, { width: size, height: size, borderRadius: size / 2 }]}>
        <Text style={styles.count}>{count}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  pinWrap: { alignItems: "center" },
  drop: {
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 3,
    shadowColor: "#000",
    shadowOpacity: 0.25,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 4,
  },
  dot: { backgroundColor: "#ffffff" },
  tip: {
    marginTop: -2,
    width: 0,
    height: 0,
    borderLeftWidth: 6,
    borderRightWidth: 6,
    borderTopWidth: 8,
    borderLeftColor: "transparent",
    borderRightColor: "transparent",
  },
  halo: { alignItems: "center", justifyContent: "center", backgroundColor: "rgba(88,28,177,0.22)" },
  bubble: {
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.brand,
    borderWidth: 3,
    borderColor: "#ffffff",
  },
  count: { fontFamily: fonts.extrabold, fontSize: 15, color: "#ffffff" },
});
