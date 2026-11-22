import { act, fireEvent, renderRouter, screen } from "expo-router/testing-library";
import { Slot } from "expo-router";
import { SafeAreaProvider } from "react-native-safe-area-context";

import ChangePasswordScreen from "../../app/change-password";
import { ApiError } from "../../lib/api";

// Rendering through the router takes a few seconds on a cold CI runner.
jest.setTimeout(30_000);

const metrics = { frame: { x: 0, y: 0, width: 360, height: 780 }, insets: { top: 24, left: 0, right: 0, bottom: 16 } };

const mockChange = jest.fn();
let mockHasPassword = true;

jest.mock("@/lib/auth", () => ({
  useAuth: () => ({
    ready: true,
    signedIn: true,
    account: { phone: "+233241115555", has_password: mockHasPassword },
    changePassword: (input: unknown) => mockChange(input),
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
  await renderRouter(
    { _layout: Layout, "change-password": ChangePasswordScreen, index: () => null },
    { initialUrl: "/change-password" },
  );
}

async function press(text: string) {
  await act(async () => {
    await fireEvent.press(screen.getByText(text));
  });
}

describe("changing the password", () => {
  it("asks for the current and the new password, and changes it", async () => {
    mockChange.mockResolvedValue(undefined);
    await open();

    expect(screen.getByText("Change the password you sign in with.")).toBeTruthy();
    await fireEvent.changeText(screen.getByLabelText("Current password"), "Kente-loom-2026");
    await fireEvent.changeText(screen.getByLabelText("New password"), "Adinkra-cloth-2027");
    await press("Change password");

    expect(mockChange).toHaveBeenCalledWith({ current_password: "Kente-loom-2026", password: "Adinkra-cloth-2027" });
    expect(screen.getByText("Password changed. Your other phones and browsers are signed out.")).toBeTruthy();
    // The boxes are emptied.
    expect(screen.getByLabelText("New password").props.value).toBe("");
  });

  it("asks only for a new password when the account was made with a phone code", async () => {
    mockHasPassword = false;
    mockChange.mockResolvedValue(undefined);
    await open();

    expect(screen.getByText("Set a password to sign in with your phone number or email.")).toBeTruthy();
    expect(screen.queryByLabelText("Current password")).toBeNull();
    expect(screen.queryByText("Change password")).toBeNull();
    await fireEvent.changeText(screen.getByLabelText("New password"), "Adinkra-cloth-2027");
    await press("Set password");

    // No current password is sent at all.
    expect(mockChange).toHaveBeenCalledWith({ password: "Adinkra-cloth-2027" });
    expect(screen.getByText("Password set. Your other phones and browsers are signed out.")).toBeTruthy();
  });

  it("shows and hides what is typed", async () => {
    await open();

    expect(screen.getByLabelText("New password").props.secureTextEntry).toBe(true);
    await act(async () => {
      await fireEvent.press(screen.getAllByLabelText("Show password")[0]);
    });

    expect(screen.getByLabelText("New password").props.secureTextEntry).toBe(false);
    expect(screen.getByLabelText("Current password").props.secureTextEntry).toBe(false);
    expect(screen.getAllByLabelText("Hide password")).toHaveLength(2);
  });

  it("checks the boxes before sending anything", async () => {
    await open();

    await fireEvent.changeText(screen.getByLabelText("New password"), "short");
    await press("Change password");

    expect(screen.getByText("Enter your current password.")).toBeTruthy();
    expect(screen.getByText("At least 8 characters.")).toBeTruthy();
    expect(mockChange).not.toHaveBeenCalled();
  });

  it("shows a wrong current password under its box", async () => {
    mockChange.mockRejectedValue(
      new ApiError(
        "That is not your current password.",
        400,
        { current_password: "That is not your current password." },
        { current_password: ["That is not your current password."] },
      ),
    );
    await open();

    await fireEvent.changeText(screen.getByLabelText("Current password"), "wrong-one-1");
    await fireEvent.changeText(screen.getByLabelText("New password"), "Adinkra-cloth-2027");
    await press("Change password");

    expect(screen.getByText("That is not your current password.")).toBeTruthy();
    expect(screen.queryByText("Password changed. Your other phones and browsers are signed out.")).toBeNull();
  });

  it("shows every rule a new password breaks under its box", async () => {
    mockChange.mockRejectedValue(
      new ApiError(
        "This password is too common.",
        400,
        { password: "This password is too common." },
        { password: ["This password is too common.", "This password is entirely numeric."] },
      ),
    );
    await open();

    await fireEvent.changeText(screen.getByLabelText("Current password"), "Kente-loom-2026");
    await fireEvent.changeText(screen.getByLabelText("New password"), "12345678");
    await press("Change password");

    expect(screen.getByText("This password is too common.\nThis password is entirely numeric.")).toBeTruthy();
  });

  it("gives the server's words when it will not take the change at all", async () => {
    mockChange.mockRejectedValue(new ApiError("Too many tries. Wait a minute and try again.", 429));
    await open();

    await fireEvent.changeText(screen.getByLabelText("Current password"), "Kente-loom-2026");
    await fireEvent.changeText(screen.getByLabelText("New password"), "Adinkra-cloth-2027");
    await press("Change password");

    expect(screen.getByText("Too many tries. Wait a minute and try again.")).toBeTruthy();
  });
});
