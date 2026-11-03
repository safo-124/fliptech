import { MapPinned } from "lucide-react-native";
import { StyleSheet, View } from "react-native";

import { Text } from "@/components/Text";
import { colors, space } from "@/theme/tokens";

/** Where the map would be, when this build cannot draw one. */
export function MapPlaceholder({ title, body }: { title: string; body: string }) {
  return (
    <View style={[StyleSheet.absoluteFill, styles.box]}>
      <MapPinned size={40} color={colors.brandViolet} />
      <Text variant="heading" style={styles.center}>
        {title}
      </Text>
      <Text variant="small" style={styles.center}>
        {body}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    alignItems: "center",
    justifyContent: "center",
    gap: space.sm,
    paddingHorizontal: space.xl,
    backgroundColor: "#e8e4dc",
  },
  center: { textAlign: "center" },
});
