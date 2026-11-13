import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
  Inter_800ExtraBold,
  useFonts,
} from "@expo-google-fonts/inter";
import { QueryClient } from "@tanstack/react-query";
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import Constants from "expo-constants";
import { Stack, type ErrorBoundaryProps } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { useEffect, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { AppServices } from "@/components/AppServices";
import { TabBarVisibilityProvider } from "@/components/FloatingTabBar";
import { Text } from "@/components/Text";
import { AuthProvider } from "@/lib/auth";
import { BagProvider } from "@/lib/bag";
import { reportCrash } from "@/lib/crash";
import { DataSaverProvider } from "@/lib/datasaver";
import { KEEP_FOR_MS, keep, persister } from "@/lib/offline.cache";
import { SavedProvider } from "@/lib/saved";
import { colors, fonts, radius, space } from "@/theme/tokens";

SplashScreen.preventAutoHideAsync();

/**
 * Data stays fresh for a minute, so moving between tabs on a slow
 * connection shows what was loaded rather than a spinner, and refetches
 * quietly behind it. It is kept for a week, on the phone too
 * (offline.cache.ts), so the app opens with something to show offline.
 */
function makeClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { staleTime: 60_000, gcTime: KEEP_FOR_MS, retry: 2, networkMode: "offlineFirst" },
    },
  });
}

/** Saved answers from another version of the app are not trusted. */
const CACHE_VERSION = `${Constants.expoConfig?.version ?? "0"}-1`;

/**
 * Anything a screen throws ends here, not in a white screen: reported to
 * our server, and a way back.
 */
export function ErrorBoundary({ error, retry }: ErrorBoundaryProps) {
  void reportCrash(error, false);
  return (
    <View style={styles.error}>
      <Text variant="title">Something went wrong</Text>
      <Text variant="body" style={{ textAlign: "center", color: colors.mutedForeground }}>
        Sorry. We have been told about it. Try again, and if it keeps happening, restart the app.
      </Text>
      <Pressable onPress={() => void retry()} style={styles.retry} accessibilityRole="button">
        <Text style={styles.retryText}>Try again</Text>
      </Pressable>
    </View>
  );
}

export default function RootLayout() {
  const [client] = useState(makeClient);
  const [fontsLoaded, fontError] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
    Inter_800ExtraBold,
  });
  const ready = fontsLoaded || Boolean(fontError);

  useEffect(() => {
    if (ready) void SplashScreen.hideAsync();
  }, [ready]);

  if (!ready) return null;

  return (
    <SafeAreaProvider>
      <PersistQueryClientProvider
        client={client}
        persistOptions={{ persister, maxAge: KEEP_FOR_MS, buster: CACHE_VERSION, dehydrateOptions: { shouldDehydrateQuery: keep } }}
      >
        <DataSaverProvider>
        <AuthProvider>
          <SavedProvider>
          <BagProvider>
          <TabBarVisibilityProvider>
            <StatusBar style="dark" />
            <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.background } }}>
              <Stack.Screen name="(tabs)" />
              <Stack.Screen name="map" options={{ animation: "slide_from_bottom" }} />
              <Stack.Screen name="search" options={{ animation: "fade" }} />
              <Stack.Screen name="sign-in" options={{ presentation: "modal", animation: "slide_from_bottom" }} />
              <Stack.Screen name="enquire" options={{ presentation: "modal", animation: "slide_from_bottom" }} />
              <Stack.Screen name="workshop/[area]/[slug]" />
              <Stack.Screen name="course/[area]/[slug]" />
              <Stack.Screen name="product/[id]" />
              <Stack.Screen name="bag" />
              <Stack.Screen name="checkout" />
              <Stack.Screen name="my-courses" />
              <Stack.Screen name="orders" />
              <Stack.Screen name="shop/[id]" />
              <Stack.Screen name="chats/index" />
              <Stack.Screen name="chats/[id]" />
              <Stack.Screen name="chats/new" />
              <Stack.Screen name="saved-searches" />
              <Stack.Screen name="bundle/[id]" />
              <Stack.Screen name="saved" />
              <Stack.Screen name="order/[reference]" />
              <Stack.Screen name="seller/index" />
              <Stack.Screen name="seller/orders" />
              <Stack.Screen name="seller/chats/index" />
              <Stack.Screen name="seller/chats/[id]" />
              <Stack.Screen name="inbox/index" />
              <Stack.Screen name="inbox/[id]" />
              <Stack.Screen name="notices" />
              <Stack.Screen name="settings" />
              <Stack.Screen name="web" options={{ animation: "none" }} />
            </Stack>
            <AppServices />
          </TabBarVisibilityProvider>
          </BagProvider>
          </SavedProvider>
        </AuthProvider>
        </DataSaverProvider>
      </PersistQueryClientProvider>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  error: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: space.md,
    padding: space.xl,
    backgroundColor: colors.background,
  },
  retry: {
    marginTop: space.md,
    minHeight: 48,
    justifyContent: "center",
    paddingHorizontal: space.xl,
    borderRadius: radius.pill,
    backgroundColor: colors.brand,
  },
  retryText: { fontFamily: fonts.bold, fontSize: 15, color: "#fff" },
});
