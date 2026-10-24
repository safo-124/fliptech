import {describe, expect, it} from "vitest";

import {embedUrl, isVideoId, thumbnailUrl, watchUrl} from "./youtube";

describe("YouTube addresses", () => {
  it("are built from the id", () => {
    expect(thumbnailUrl("dQw4w9WgXcQ")).toBe("https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg");
    expect(watchUrl("dQw4w9WgXcQ")).toBe("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
    expect(embedUrl("dQw4w9WgXcQ")).toMatch(
      /^https:\/\/www\.youtube-nocookie\.com\/embed\/dQw4w9WgXcQ\?/,
    );
  });

  it.each(["", "short", "dQw4w9WgXcQx", 'dQw4w9WgX"Q', "../../evil1"])(
    "refuse anything that is not an id: %j",
    (id) => {
      expect(isVideoId(id)).toBe(false);
      expect(() => embedUrl(id)).toThrow();
    },
  );
});
