import Constants from "expo-constants";
import {
  BookOpen,
  ChevronRight,
  FileText,
  Heart,
  Languages,
  Package,
  ShieldCheck,
  Store,
  UserRound,
  type LucideIcon,
} from "lucide-react-native";
import { Pressable, StyleSheet, View } from "react-native";

import { Screen } from "@/components/Screen";
import { Text } from "@/components/Text";
import { openOnSite } from "@/lib/open";
import { colors, fonts, radius, shadow, space } from "@/theme/tokens";

type Row = { icon: LucideIcon; label: string; path: string };

/**
 * Until sign-in is in the app, each of these opens its page on the
 * website inside the app, where the learner can sign in as they do today.
 */
const GROUPS: { title: string; rows: Row[] }[] = [
  {
    title: "Your things",
    rows: [
      { icon: BookOpen, label: "My courses", path: "/learn/mine" },
      { icon: Package, label: "My orders", path: "/account" },
      { icon: Heart, label: "Saved", path: "/account" },
    ],
  },
  {
    title: "Work with us",
    rows: [
      { icon: UserRound, label: "Teach a course or list your workshop", path: "/join" },
      { icon: Store, label: "Sell on the marketplace", path: "/sell" },
    ],
  },
  {
    title: "About",
    rows: [
      { icon: Languages, label: "Language", path: "/language" },
      { icon: ShieldCheck, label: "Privacy", path: "/privacy" },
      { icon: FileText, label: "Marketplace terms", path: "/marketplace/terms" },
    ],
  },
];

export default function MeScreen() {
  return (
    <Screen>
      <View style={styles.head}>
        <Text variant="eyebrow">YOUR ACCOUNT</Text>
        <Text variant="display" style={{ marginTop: 4 }}>
          Me
        </Text>
      </View>

      <View style={styles.signIn}>
        <View style={styles.avatar}>
          <UserRound size={28} color={colors.brand} />
        </View>
        <View style={{ flex: 1 }}>
          <Text variant="heading">Sign in with your phone</Text>
          <Text variant="small">
            Coming in the next update: your courses, orders and saved things, on any phone.
          </Text>
        </View>
      </View>

      {GROUPS.map((group) => (
        <View key={group.title} style={styles.group}>
          <Text variant="label" style={styles.groupTitle}>
            {group.title}
          </Text>
          <View style={styles.list}>
            {group.rows.map(({ icon: Icon, label, path }, index) => (
              <Pressable
                key={label}
                onPress={() => void openOnSite(path)}
                accessibilityRole="link"
                style={({ pressed }) => [
                  styles.row,
                  index > 0 ? styles.divider : null,
                  pressed ? { backgroundColor: colors.muted } : null,
                ]}
              >
                <View style={styles.icon}>
                  <Icon size={18} color={colors.brand} />
                </View>
                <Text style={styles.rowText}>{label}</Text>
                <ChevronRight size={18} color={colors.mutedForeground} />
              </Pressable>
            ))}
          </View>
        </View>
      ))}

      <Text variant="small" style={styles.version}>
        Fliiptech {Constants.expoConfig?.version ?? ""}
      </Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  head: { paddingHorizontal: space.lg, paddingTop: space.sm },
  signIn: {
    marginTop: space.xl,
    marginHorizontal: space.lg,
    flexDirection: "row",
    alignItems: "center",
    gap: space.md,
    padding: space.lg,
    borderRadius: radius.lg,
    backgroundColor: colors.brandSoft,
  },
  avatar: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.card,
    alignItems: "center",
    justifyContent: "center",
  },
  group: { marginTop: space.xl, paddingHorizontal: space.lg },
  groupTitle: { color: colors.mutedForeground, marginBottom: space.sm, marginLeft: 4 },
  list: {
    borderRadius: radius.lg,
    backgroundColor: colors.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    overflow: "hidden",
    ...shadow.card,
  },
  row: { flexDirection: "row", alignItems: "center", gap: space.md, minHeight: 56, paddingHorizontal: space.lg },
  divider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  icon: {
    width: 34,
    height: 34,
    borderRadius: 10,
    backgroundColor: colors.brandSoft,
    alignItems: "center",
    justifyContent: "center",
  },
  rowText: { flex: 1, fontFamily: fonts.medium, fontSize: 15, color: colors.foreground },
  version: { textAlign: "center", marginTop: space.xl },
});
