import { newTracker, takePlayed, trackPlayhead } from "./played";

describe("following the playhead", () => {
  it("counts playing, not seeking", () => {
    const tracker = newTracker();
    for (let second = 0; second <= 10; second += 1) trackPlayhead(tracker, second);
    trackPlayhead(tracker, 95);
    trackPlayhead(tracker, 96);
    expect(takePlayed(tracker)).toEqual([
      [0, 10],
      [95, 96],
    ]);
    expect(takePlayed(tracker)).toEqual([]);
  });
});
