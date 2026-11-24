import {describe, expect, it} from "vitest";

import {frameStyle} from "./media-aspect";

describe("a video's frame", () => {
  it("keeps a landscape video full width at its own shape", () => {
    expect(frameStyle(16 / 9)).toEqual({aspectRatio: String(16 / 9)});
  });

  it("shows a portrait video as portrait, centred and no taller than the screen", () => {
    const style = frameStyle(9 / 16);
    expect(style.aspectRatio).toBe(String(9 / 16));
    expect(style.width).toBe(`min(100%, calc(80vh * ${9 / 16}))`);
    expect(style.marginInline).toBe("auto");
  });
});
