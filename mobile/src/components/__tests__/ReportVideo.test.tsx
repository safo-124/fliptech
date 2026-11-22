import { act, fireEvent, render, screen } from "@testing-library/react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { ApiError } from "../../lib/api";
import { ReportVideoSheet } from "../ReportVideoSheet";

// The first render pulls in the whole form on a cold runner.
jest.setTimeout(30_000);

const metrics = { frame: { x: 0, y: 0, width: 360, height: 780 }, insets: { top: 24, left: 0, right: 0, bottom: 16 } };

const mockReport = jest.fn();
jest.mock("@/lib/api", () => {
  const actual = jest.requireActual("@/lib/api");
  return { ...actual, api: { ...actual.api, reportVideo: (...args: unknown[]) => mockReport(...args) } };
});

async function open() {
  await render(
    <SafeAreaProvider initialMetrics={metrics}>
      <ReportVideoSheet videoId={42} videoTitle="Lesson 3: Box braids" visible onClose={() => undefined} />
    </SafeAreaProvider>,
  );
}

async function press(text: string) {
  await act(async () => {
    await fireEvent.press(screen.getByText(text));
  });
}

beforeEach(() => jest.clearAllMocks());

describe("reporting a lesson video", () => {
  it("sends the reason and the note, then thanks", async () => {
    mockReport.mockResolvedValue({ reported: true });
    await open();

    await press("Unsafe use of chemicals, heat or tools");
    await fireEvent.changeText(
      screen.getByLabelText("Anything else our team should know (optional)"),
      "  No gloves with the relaxer.  ",
    );
    await press("Send report");

    expect(mockReport).toHaveBeenCalledWith(42, "unsafe", "No gloves with the relaxer.");
    expect(screen.getByText("Thanks. Our team will look at it.")).toBeTruthy();
  });

  it("offers every reason the server knows", async () => {
    await open();

    expect(screen.getAllByRole("radio")).toHaveLength(7);
    for (const label of [
      "It is not their own video",
      "Someone in it did not agree to be filmed",
      "A child appears without a guardian",
      "Unsafe use of chemicals, heat or tools",
      "Sexual, violent or abusive",
      "It only advertises, it does not teach",
      "Something else",
    ]) {
      expect(screen.getByText(label)).toBeTruthy();
    }
  });

  it("asks for a reason before sending anything", async () => {
    await open();

    await press("Send report");

    expect(screen.getByText("Choose what is wrong with this video.")).toBeTruthy();
    expect(mockReport).not.toHaveBeenCalled();
  });

  it("says so when too many reports were sent", async () => {
    mockReport.mockRejectedValue(new ApiError("Request was throttled.", 429));
    await open();

    await press("Something else");
    await press("Send report");

    expect(screen.getByText("You have sent too many reports for now. Try again later.")).toBeTruthy();
    expect(screen.queryByText("Thanks. Our team will look at it.")).toBeNull();
  });

  it("says so when the video is no longer shown", async () => {
    mockReport.mockRejectedValue(new ApiError("Not found.", 404));
    await open();

    await press("It is not their own video");
    await press("Send report");

    expect(screen.getByText("This video is no longer shown, so there is nothing to report.")).toBeTruthy();
  });
});
