import { router, useLocalSearchParams } from "expo-router";
import { useEffect } from "react";
import { ActivityIndicator, View } from "react-native";

import { openOnSite } from "@/lib/open";
import { colors } from "@/theme/tokens";

/** A page of the website the app has no screen for: opened in the in-app
    browser, and back to where the person was when they close it. */
export default function WebScreen() {
  const { path } = useLocalSearchParams<{ path?: string }>();
  useEffect(() => {
    const target = path && path.startsWith("/") ? path : "/";
    void openOnSite(target).finally(() => (router.canGoBack() ? router.back() : router.replace("/")));
  }, [path]);
  return (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.background }}>
      <ActivityIndicator color={colors.brand} />
    </View>
  );
}
