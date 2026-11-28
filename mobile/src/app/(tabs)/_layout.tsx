import { Tabs } from "expo-router/tabs";

import { FloatingTabBar, useTabBarVisibility } from "@/components/FloatingTabBar";
import { totalUnread } from "@/lib/messages";
import { useChatCounts } from "@/lib/use-chat-counts";

/**
 * The five tabs, in the order the bar shows them: Home, Explore (training
 * near you), Learn (online courses), Shop (the marketplace) and Me.
 */
export default function TabsLayout() {
  const visibility = useTabBarVisibility();
  // Unread messages ride on Me, where Messages lives (app/messages.tsx).
  const unread = totalUnread(useChatCounts());
  return (
    <Tabs
      tabBar={(props) => <FloatingTabBar {...props} />}
      screenOptions={{ headerShown: false }}
      // A new tab always starts with the bar showing.
      screenListeners={{
        focus: () => {
          if (visibility) visibility.hidden.set(0);
        },
      }}
    >
      <Tabs.Screen name="index" options={{ title: "Home" }} />
      <Tabs.Screen name="explore" options={{ title: "Explore" }} />
      <Tabs.Screen name="learn" options={{ title: "Learn" }} />
      <Tabs.Screen name="shop" options={{ title: "Shop" }} />
      <Tabs.Screen
        name="me"
        options={{
          title: "Me",
          tabBarBadge: unread > 0 ? (unread > 99 ? "99+" : unread) : undefined,
          tabBarAccessibilityLabel: unread > 0 ? `Me, ${unread} unread ${unread === 1 ? "message" : "messages"}` : undefined,
        }}
      />
    </Tabs>
  );
}
