import { act, fireEvent, render, screen } from "@testing-library/react-native";
import { Alert, type AlertButton } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { ChatView } from "../ChatView";

// The first render pulls in the whole chat on a cold runner.
jest.setTimeout(30_000);

const metrics = { frame: { x: 0, y: 0, width: 360, height: 780 }, insets: { top: 24, left: 0, right: 0, bottom: 16 } };

async function open(props: Partial<Parameters<typeof ChatView>[0]> = {}) {
  await render(
    <SafeAreaProvider initialMetrics={metrics}>
      <ChatView
        title="Kofi"
        messages={[]}
        loading={false}
        sending={false}
        problem={null}
        onSend={async () => true}
        onReport={async () => undefined}
        {...props}
      />
    </SafeAreaProvider>,
  );
}

async function press(target: ReturnType<typeof screen.getByText>) {
  await act(async () => {
    await fireEvent.press(target);
  });
}

beforeEach(() => jest.restoreAllMocks());

describe("blocking in a chat", () => {
  it("asks first, then blocks", async () => {
    const onBlock = jest.fn().mockResolvedValue(undefined);
    const alert = jest.spyOn(Alert, "alert").mockImplementation((_title, _message, buttons?: AlertButton[]) => {
      buttons?.find((button) => button.text === "Block")?.onPress?.();
    });
    await open({ onBlock });

    await press(screen.getByLabelText("Block Kofi"));

    expect(alert.mock.calls[0][0]).toBe("Block Kofi?");
    expect(onBlock).toHaveBeenCalledWith(true);
  });

  it("does nothing when they cancel", async () => {
    const onBlock = jest.fn();
    jest.spyOn(Alert, "alert").mockImplementation(() => undefined);
    await open({ onBlock });

    await press(screen.getByLabelText("Block Kofi"));

    expect(onBlock).not.toHaveBeenCalled();
  });

  it("swaps the box to write in for a note and Unblock, for whoever blocked", async () => {
    const onBlock = jest.fn().mockResolvedValue(undefined);
    await open({ onBlock, blockedByYou: true, canWrite: false });

    expect(screen.getByText("You blocked Kofi. Neither of you can write here.")).toBeTruthy();
    expect(screen.queryByLabelText("Your message")).toBeNull();
    expect(screen.queryByLabelText("Block Kofi")).toBeNull();
    await press(screen.getByText("Unblock"));

    expect(onBlock).toHaveBeenCalledWith(false);
  });

  it("tells the side that was blocked only that it cannot write, with no Unblock", async () => {
    await open({ onBlock: jest.fn(), onShare: async () => undefined, blockedByYou: false, canWrite: false });

    expect(screen.getByText("You cannot send messages in this chat.")).toBeTruthy();
    expect(screen.queryByText("Unblock")).toBeNull();
    expect(screen.queryByText("Share my number")).toBeNull();
    expect(screen.queryByLabelText("Your message")).toBeNull();
  });

  it("keeps the box to write in while nobody is blocked", async () => {
    await open({ onBlock: jest.fn() });

    expect(screen.getByLabelText("Your message")).toBeTruthy();
    expect(screen.getByLabelText("Block Kofi")).toBeTruthy();
  });
});
