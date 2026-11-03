import Constants from "expo-constants";
import { router, type Href } from "expo-router";
import {
  BookOpen,
  ChevronRight,
  FileText,
  Heart,
  Languages,
  LogOut,
  Package,
  ShieldCheck,
  Store,
  UserRound,
  type LucideIcon,
} from "lucide-react-native";
import { Alert, Pressable, StyleSheet, View } from "react-native";

import { Button } from "@/components/Form";
import { Screen } from "@/components/Screen";
import { Text } from "@/components/Text";
import { useAuth } from "@/lib/auth";
import { openOnSite } from "@/lib/open";
import { showPhone } from "@/lib/phone";
import { colors, fonts, radius, shadow, space } from "@/theme/tokens";

/** A row opens an app screen (`to`) or, until the app has one, the website (`site`). */
type Row = { icon: LucideIcon; label: string; to?: Href; site?: string; signedIn?: boolean };

const GROUPS: { title: string; rows: Row[] }[] = [
  {
    title: "Your things",
    rows: [
      { icon: BookOpen, label: "My courses", to: "/my-courses", signedIn: true },
      { icon: Package, label: "My orders", to: "/orders", signedIn: true },
      { icon: Heart, label: "Saved", site: "/account" },
    ],
  },
  {
    title: "Work with us",
    rows: [
      { icon: UserRound, label: "Teach a course or list your workshop", site: "/join" },
      { icon: Store, label: "Sell on the marketplace", site: "/sell" },
    ],
  },
  {
    title: "About",
    rows: [
      { icon: Languages, label: "Language", site: "/language" },
      { icon: ShieldCheck, label: "Privacy", site: "/privacy" },
      { icon: FileText, label: "Marketplace terms", site: "/marketplace/terms" },
    ],
  },
];

export default function MeScreen() {
  const auth = useAuth();
  const name = auth.account?.display_name || "";

  function open(row: Row) {
    if (row.signedIn && !auth.signedIn) {
      router.push({ pathname: "/sign-in", params: { why: `to see ${row.label.toLowerCase()}` } });
    } else if (row.to) {
      router.push(row.to);
    } else if (row.site) {
      void openOnSite(row.site);
    }
  }

  function confirmSignOut() {
    Alert.alert("Sign out?", "You can sign in again any time with your phone number.", [
      { text: "Stay signed in", style: "cancel" },
      { text: "Sign out", style: "destructive", onPress: () => void auth.signOut() },
    ]);
  }

  return (
    <Screen>
      <View style={styles.head}>
        <Text variant="eyebrow">YOUR ACCOUNT</Text>
        <Text variant="display" style={{ marginTop: 4 }}>
          Me
        </Text>
      </View>

      {auth.signedIn && auth.account ? (
        <View style={styles.card}>
          <View style={styles.avatar}>
            <Text style={styles.initial}>{(name || "?").slice(0, 1).toUpperCase()}</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text variant="heading">{name || "Welcome"}</Text>
            <Text variant="small">{showPhone(auth.account.phone)}</Text>
          </View>
        </View>
      ) : (
        <View style={[styles.card, styles.signIn]}>
          <View style={styles.avatarLight}>
            <UserRound size={28} color={colors.brand} />
          </View>
          <View style={{ flex: 1, gap: space.sm }}>
            <Text variant="heading">Sign in with your phone</Text>
            <Text variant="small">Your courses, orders and saved things, on any phone. No password.</Text>
            <Button
              label={auth.ready ? "Sign in" : "…"}
              disabled={!auth.ready}
              onPress={() => router.push("/sign-in")}
              style={{ alignSelf: "flex-start", minHeight: 44, paddingHorizontal: space.lg }}
            />
          </View>
        </View>
      )}

      {GROUPS.map((group) => (
        <View key={group.title} style={styles.group}>
          <Text variant="label" style={styles.groupTitle}>
            {group.title}
          </Text>
          <View style={styles.list}>
            {group.rows.map((row, index) => (
              <Pressable
                key={row.label}
                onPress={() => open(row)}
                accessibilityRole="link"
                style={({ pressed }) => [
                  styles.row,
                  index > 0 ? styles.divider : null,
                  pressed ? { backgroundColor: colors.muted } : null,
                ]}
              >
                <View style={styles.icon}>
                  <row.icon size={18} color={colors.brand} />
                </View>
                <Text style={styles.rowText}>{row.label}</Text>
                <ChevronRight size={18} color={colors.mutedForeground} />
              </Pressable>
            ))}
          </View>
        </View>
      ))}

      {auth.signedIn ? (
        <View style={styles.group}>
          <Pressable onPress={confirmSignOut} style={[styles.list, styles.row]} accessibilityRole="button">
            <View style={[styles.icon, { backgroundColor: "#fdecec" }]}>
              <LogOut size={18} color={colors.destructive} />
            </View>
            <Text style={[styles.rowText, { color: colors.destructive }]}>Sign out</Text>
          </Pressable>
        </View>
      ) : null}

      <Text variant="small" style={styles.version}>
        Fliiptech {Constants.expoConfig?.version ?? ""}
      </Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  head: { paddingHorizontal: space.lg, paddingTop: space.sm },
  card: {
    marginTop: space.xl,
    marginHorizontal: space.lg,
    flexDirection: "row",
    alignItems: "center",
    gap: space.md,
    padding: space.lg,
    borderRadius: radius.lg,
    backgroundColor: colors.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    ...shadow.card,
  },
  signIn: { backgroundColor: colors.brandSoft, borderColor: colors.brandSoft, alignItems: "flex-start" },
  avatar: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.brand,
    alignItems: "center",
    justifyContent: "center",
  },
  initial: { fontFamily: fonts.extrabold, fontSize: 22, color: "#ffffff" },
  avatarLight: {
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
