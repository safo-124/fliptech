import { act, fireEvent, renderRouter, screen } from "expo-router/testing-library";
import { Slot } from "expo-router";
import { SafeAreaProvider } from "react-native-safe-area-context";

import DeleteAccountScreen from "../../app/delete-account";

// Rendering through the router takes a few seconds on a cold CI runner.
jest.setTimeout(20_000);

const metrics = { frame: { x: 0, y: 0, width: 360, height: 780 }, insets: { top: 24, left: 0, right: 0, bottom: 16 } };

const mockDelete = jest.fn(async () => undefined);
let mockHasPassword = true;

jest.mock("@/lib/auth", () => ({
  useAuth: () => ({
    ready: true,
    signedIn: true,
    account: { phone: "+233241115555", has_password: mockHasPassword },
    deleteAccount: mockDelete,
  }),
}));

function Layout() {
  return (
    <SafeAreaProvider initialMetrics={metrics}>
      <Slot />
    </SafeAreaProvider>
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  mockHasPassword = true;
});

async function open() {
  await renderRouter({ _layout: Layout, "delete-account": DeleteAccountScreen, index: () => null }, { initialUrl: "/delete-account" });
}

describe("deleting the account", () => {
  it("needs the password and DELETE typed before it deletes", async () => {
    await open();

    await act(async () => {
      fireEvent.press(screen.getByText("Delete everything for good"));
    });
    expect(mockDelete).not.toHaveBeenCalled();

    await fireEvent.changeText(screen.getByLabelText("Your password"), "Kente-loom-2026");
    await fireEvent.changeText(screen.getByLabelText("Type DELETE to confirm"), "delete");
    await act(async () => {
      fireEvent.press(screen.getByText("Delete everything for good"));
    });

    expect(mockDelete).toHaveBeenCalledWith("Kente-loom-2026");
  });

  it("asks no password of an account that only used codes", async () => {
    mockHasPassword = false;
    await open();

    expect(screen.queryByLabelText("Your password")).toBeNull();
    await fireEvent.changeText(screen.getByLabelText("Type DELETE to confirm"), "DELETE");
    await act(async () => {
      fireEvent.press(screen.getByText("Delete everything for good"));
    });

    expect(mockDelete).toHaveBeenCalledWith(undefined);
  });
});
