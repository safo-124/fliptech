import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
  Inter_800ExtraBold,
  useFonts,
} from "@expo-google-fonts/inter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { useEffect, useState } from "react";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { TabBarVisibilityProvider } from "@/components/FloatingTabBar";
import { AuthProvider } from "@/lib/auth";
import { BagProvider } from "@/lib/bag";
import { SavedProvider } from "@/lib/saved";
import { colors } from "@/theme/tokens";

SplashScreen.preventAutoHideAsync();

/**
 * Data stays fresh for a minute and is kept for half an hour, so moving
 * between tabs on a slow connection shows what was loaded rather than a
 * spinner, and refetches quietly behind it.
 */
function makeClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { staleTime: 60_000, gcTime: 30 * 60_000, retry: 2 },
    },
  });
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
      <QueryClientProvider client={client}>
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
              <Stack.Screen name="seller" />
            </Stack>
          </TabBarVisibilityProvider>
          </BagProvider>
          </SavedProvider>
        </AuthProvider>
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}
