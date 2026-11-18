import { act, fireEvent, renderRouter, screen } from "expo-router/testing-library";
import { Slot } from "expo-router";
import { SafeAreaProvider } from "react-native-safe-area-context";

import SignInScreen from "../../app/sign-in";

// Rendering through the router takes a few seconds on a cold CI runner.
jest.setTimeout(20_000);

const metrics = { frame: { x: 0, y: 0, width: 360, height: 780 }, insets: { top: 24, left: 0, right: 0, bottom: 16 } };

const mockSignIn = jest.fn(async () => undefined);
const mockRegister = jest.fn(async () => undefined);
const mockForgot = jest.fn(async () => "If that account has an email address, a link is on its way.");
let mockCodeOn = false;

jest.mock("@/lib/auth", () => ({
  useAuth: () => ({
    ready: true,
    signedIn: false,
    account: null,
    roles: null,
    codeSignIn: mockCodeOn,
    requestCode: jest.fn(),
    verifyCode: jest.fn(),
    signInWithPassword: mockSignIn,
    register: mockRegister,
    forgotPassword: mockForgot,
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
  mockCodeOn = false;
});

async function open() {
  await renderRouter({ _layout: Layout, "sign-in": SignInScreen, me: () => null }, { initialUrl: "/sign-in" });
}

describe("signing in with a password", () => {
  it("signs in with a phone number or email and the password", async () => {
    await open();

    await fireEvent.changeText(screen.getByLabelText("Phone number or email"), "024 111 5555");
    await fireEvent.changeText(screen.getByLabelText("Password"), "Kente-loom-2026");
    await act(async () => {
      fireEvent.press(screen.getByRole("button", { name: "Sign in" }));
    });

    expect(mockSignIn).toHaveBeenCalledWith("024 111 5555", "Kente-loom-2026");
    // No code offered while it is switched off.
    expect(screen.queryByText("Send me a code instead")).toBeNull();
  });

  it("creates an account with phone, email and password", async () => {
    await open();
    await fireEvent.press(screen.getByText("New here? Create an account"));

    await fireEvent.changeText(screen.getByLabelText("Phone number"), "24 111 5555");
    await fireEvent.changeText(screen.getByLabelText("Email (optional)"), "esi@example.com");
    await fireEvent.changeText(screen.getByLabelText("Choose a password"), "Kente-loom-2026");
    await fireEvent.changeText(screen.getByLabelText("Confirm password"), "Kente-loom-2026");
    await act(async () => {
      fireEvent.press(screen.getByText("Create my account"));
    });

    expect(mockRegister).toHaveBeenCalledWith({
      phone: "+233241115555",
      email: "esi@example.com",
      password: "Kente-loom-2026",
      name: "",
    });
  });

  it("creates an account without an email", async () => {
    await open();
    await fireEvent.press(screen.getByText("New here? Create an account"));

    await fireEvent.changeText(screen.getByLabelText("Phone number"), "24 111 5555");
    await fireEvent.changeText(screen.getByLabelText("Choose a password"), "Kente-loom-2026");
    await fireEvent.changeText(screen.getByLabelText("Confirm password"), "Kente-loom-2026");
    await act(async () => {
      fireEvent.press(screen.getByText("Create my account"));
    });

    expect(mockRegister).toHaveBeenCalledWith({ phone: "+233241115555", email: "", password: "Kente-loom-2026", name: "" });
  });

  it("refuses an email that is not one", async () => {
    await open();
    await fireEvent.press(screen.getByText("New here? Create an account"));

    await fireEvent.changeText(screen.getByLabelText("Phone number"), "24 111 5555");
    await fireEvent.changeText(screen.getByLabelText("Email (optional)"), "esi@");
    await fireEvent.changeText(screen.getByLabelText("Choose a password"), "Kente-loom-2026");
    await fireEvent.changeText(screen.getByLabelText("Confirm password"), "Kente-loom-2026");
    await act(async () => {
      fireEvent.press(screen.getByText("Create my account"));
    });

    expect(mockRegister).not.toHaveBeenCalled();
    expect(screen.getByText("Enter an email address, like you@example.com.")).toBeTruthy();
  });

  it("emails a link to set a new password", async () => {
    await open();
    await fireEvent.press(screen.getByText("Forgot your password?"));

    await fireEvent.changeText(screen.getByLabelText("Phone number or email"), "esi@example.com");
    await act(async () => {
      fireEvent.press(screen.getByText("Email me a link"));
    });

    expect(mockForgot).toHaveBeenCalledWith("esi@example.com");
    expect(await screen.findByText("If that account has an email address, a link is on its way.")).toBeTruthy();
  });

  it("offers the code only when it is switched on", async () => {
    mockCodeOn = true;
    await open();

    expect(screen.getByText("Send me a code instead")).toBeTruthy();
  });

  it("refuses two passwords that are not the same", async () => {
    await open();
    await fireEvent.press(screen.getByText("New here? Create an account"));

    await fireEvent.changeText(screen.getByLabelText("Phone number"), "24 111 5555");
    await fireEvent.changeText(screen.getByLabelText("Email (optional)"), "esi@example.com");
    await fireEvent.changeText(screen.getByLabelText("Choose a password"), "Kente-loom-2026");
    await fireEvent.changeText(screen.getByLabelText("Confirm password"), "Kente-loom-2027");
    await act(async () => {
      fireEvent.press(screen.getByText("Create my account"));
    });

    expect(mockRegister).not.toHaveBeenCalled();
    expect(screen.getAllByText("The two passwords are not the same.").length).toBeGreaterThan(0);
  });
});
