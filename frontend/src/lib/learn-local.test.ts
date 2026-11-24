import {describe, expect, it} from "vitest";

import {advance, isFinished, newTracker, playedSeconds, takePlayed, trackPlayhead} from "./learn-local";

describe("a lesson counts as finished", () => {
  it("at 90% of it actually played", () => {
    expect(isFinished(899, 1000)).toBe(false);
    expect(isFinished(900, 1000)).toBe(true);
  });

  it("once played at all, when its length is not known", () => {
    expect(isFinished(0, 0)).toBe(false);
    expect(isFinished(3, 0)).toBe(true);
  });
});

describe("following the playhead", () => {
  it("counts playing, not seeking", () => {
    const tracker = newTracker();
    for (let second = 0; second <= 10; second += 0.5) trackPlayhead(tracker, second);
    trackPlayhead(tracker, 95); // dragged to the end
    trackPlayhead(tracker, 95.5);
    const played = takePlayed(tracker);
    expect(played).toEqual([
      [0, 10],
      [95, 96],
    ]);
    expect(takePlayed(tracker)).toEqual([]);
  });

  it("does not count going back", () => {
    const tracker = newTracker();
    trackPlayhead(tracker, 50);
    trackPlayhead(tracker, 20);
    expect(takePlayed(tracker)).toEqual([]);
  });
});

describe("progress", () => {
  it("is not finished by jumping to the end", () => {
    expect(advance(undefined, 100, 100, []).completed).toBe(false);
  });

  it("finishes once 90% has been played, and rewinding keeps it", () => {
    const watched = advance(undefined, 92, 100, [[0, 92]]);
    expect(watched.completed).toBe(true);
    expect(advance(watched, 10, 100, []).completed).toBe(true);
  });

  it("does not count the same part twice", () => {
    const row = advance(advance(undefined, 40, 100, [[0, 40]]), 40, 100, [[0, 40]]);
    expect(playedSeconds(row.watched ?? [])).toBe(40);
    expect(row.completed).toBe(false);
  });
});
