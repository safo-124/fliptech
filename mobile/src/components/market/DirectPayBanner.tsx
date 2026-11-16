import { IdCard } from "lucide-react-native";
import { StyleSheet, View } from "react-native";

import { Button } from "@/components/Form";
import { Text } from "@/components/Text";
import { openOnSite } from "@/lib/open";
import { colors, radius, space } from "@/theme/tokens";

/**
 * For a seller whose ID is not checked yet: buyers can only order and pay
 * them directly. Sending the ID turns on Buy now with MoMo or card. The
 * same banner as the website's dashboard.
 */
export function DirectPayBanner() {
  return (
    <View style={styles.banner}>
      <Text variant="small" style={{ color: colors.foreground }}>
        Buyers can only order and pay you directly. Send your ID to turn on Buy
        now with MoMo or card.
      </Text>
      <Button
        label="Send my ID"
        tone="soft"
        icon={<IdCard size={16} color={colors.brand} />}
        onPress={() => void openOnSite("/sell/shop")}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    gap: space.sm,
    padding: space.md,
    borderRadius: radius.lg,
    backgroundColor: colors.warnBg,
  },
});
