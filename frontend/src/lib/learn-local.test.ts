import {describe, expect, it} from "vitest";

import {advance, isFinished} from "./learn-local";

describe("a lesson counts as finished", () => {
  it("at 90% of it", () => {
    expect(isFinished(899, 1000)).toBe(false);
    expect(isFinished(900, 1000)).toBe(true);
  });

  it("in its last 20 seconds, however long it is", () => {
    expect(isFinished(575, 600)).toBe(true);
    expect(isFinished(500, 600)).toBe(false);
  });

  it("once started, when its length is not known", () => {
    expect(isFinished(0, 0)).toBe(false);
    expect(isFinished(3, 0)).toBe(true);
  });
});

describe("progress", () => {
  it("keeps the furthest point when the learner rewinds", () => {
    const watched = advance(undefined, 95, 100, false);
    expect(watched).toEqual({position: 95, furthest: 95, completed: true});
    expect(advance(watched, 10, 100, false)).toEqual({position: 10, furthest: 95, completed: true});
  });

  it("finishes at the end however far the bar was", () => {
    expect(advance(undefined, 30, 100, true).completed).toBe(true);
  });
});
