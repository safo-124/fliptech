import { Tabs } from "expo-router/tabs";
import { fireEvent, renderRouter, screen } from "expo-router/testing-library";
import { Text } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { FloatingTabBar } from "../FloatingTabBar";

const metrics = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 47, left: 0, right: 0, bottom: 34 } };

function Layout() {
  return (
    <SafeAreaProvider initialMetrics={metrics}>
      <Tabs tabBar={(props) => <FloatingTabBar {...props} />} screenOptions={{ headerShown: false }}>
        <Tabs.Screen name="index" options={{ title: "Home" }} />
        <Tabs.Screen name="explore" options={{ title: "Explore" }} />
        <Tabs.Screen name="learn" options={{ title: "Learn", tabBarBadge: 2 }} />
        <Tabs.Screen name="shop" options={{ title: "Shop", tabBarBadge: "" }} />
        <Tabs.Screen name="me" options={{ title: "Me" }} />
      </Tabs>
    </SafeAreaProvider>
  );
}

function page(name: string) {
  function Page() {
    return <Text>{`${name} page`}</Text>;
  }
  Page.displayName = `${name}Page`;
  return Page;
}

async function render() {
  return renderRouter({
    _layout: Layout,
    index: page("Home"),
    explore: page("Explore"),
    learn: page("Learn"),
    shop: page("Shop"),
    me: page("Me"),
  });
}

describe("the floating tab bar", () => {
  it("shows the five tabs, in order, with a word under each icon, and badges", async () => {
    await render();
    const tabs = screen.getAllByRole("tab");
    expect(tabs.map((tab) => tab.props.accessibilityLabel)).toEqual(["Home", "Explore", "Learn", "Shop", "Me"]);
    expect(screen.getByText("Shop")).toBeTruthy();
    // A number badge on Learn; Shop's empty one is a dot, with no number.
    expect(screen.getByText("2")).toBeTruthy();
  });

  it("marks the open tab and moves to another when tapped", async () => {
    await render();
    expect(screen.getByTestId("tab-index").props.accessibilityState).toEqual({ selected: true });
    fireEvent.press(screen.getByTestId("tab-shop"));
    expect(await screen.findByText("Shop page")).toBeTruthy();
    expect(screen.getByTestId("tab-shop").props.accessibilityState).toEqual({ selected: true });
    expect(screen.getByTestId("tab-index").props.accessibilityState).toEqual({ selected: false });
  });
});
