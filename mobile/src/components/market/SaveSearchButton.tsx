import { router } from "expo-router";
import { BellRing, Check } from "lucide-react-native";
import { useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet } from "react-native";

import { Text } from "@/components/Text";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { savedSearchParams, type MarketFilters } from "@/lib/market";
import { colors, fonts, radius, space } from "@/theme/tokens";

/** "Text me new matches": keep this search on the account. */
export function SaveSearchButton({ filters }: { filters: MarketFilters }) {
  const auth = useAuth();
  const [state, setState] = useState<"idle" | "busy" | "saved" | "failed">("idle");
  const [message, setMessage] = useState("");
  const key = JSON.stringify(filters);
  const [savedFor, setSavedFor] = useState("");
  const saved = state === "saved" && savedFor === key;

  async function save() {
    if (!auth.signedIn) {
      router.push({ pathname: "/sign-in", params: { why: "to get texts about new matches" } });
      return;
    }
    setState("busy");
    try {
      await api.saveSearch(savedSearchParams(filters), filters.q || filters.seller?.name || "Marketplace search");
      setSavedFor(key);
      setState("saved");
    } catch (error) {
      setMessage(error instanceof ApiError ? error.message : "That did not save.");
      setState("failed");
    }
  }

  return (
    <Pressable
      onPress={() => void save()}
      disabled={state === "busy" || saved}
      accessibilityRole="button"
      style={[styles.button, saved ? styles.done : null]}
    >
      {state === "busy" ? (
        <ActivityIndicator color={colors.brand} />
      ) : saved ? (
        <Check size={16} color={colors.visit} />
      ) : (
        <BellRing size={16} color={colors.brand} />
      )}
      <Text style={[styles.text, saved ? { color: colors.visit } : null]}>
        {saved ? "Saved. We'll text you new matches." : state === "failed" ? message : "Text me new matches"}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: space.sm,
    minHeight: 40,
    paddingHorizontal: space.md,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.brandSoft,
    backgroundColor: colors.card,
  },
  done: { borderColor: colors.visitBg, backgroundColor: colors.visitBg },
  text: { fontFamily: fonts.semibold, fontSize: 13, color: colors.brand },
});
