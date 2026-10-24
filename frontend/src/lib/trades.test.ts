import {readFileSync} from "node:fs";
import {join} from "node:path";

import {describe, expect, it} from "vitest";

import {TRADE_COLOURS, TRADE_HEX, tradeClass, tradeColour} from "./trades";

describe("trade colours", () => {
  it("fall back to the brand's violet for anything unknown", () => {
    expect(tradeColour("coral")).toBe("coral");
    expect(tradeColour("tartan")).toBe("violet");
    expect(tradeColour(null)).toBe("violet");
    expect(tradeClass(undefined)).toBe("trade-violet");
  });

  it("match the stylesheet, so a share card is the same colour as the page", () => {
    const css = readFileSync(join(__dirname, "../app/globals.css"), "utf-8");
    for (const colour of TRADE_COLOURS) {
      const {bg, fg, strong} = TRADE_HEX[colour];
      expect(css).toContain(
        `.trade-${colour} { --trade-bg: ${bg}; --trade-fg: ${fg}; --trade-strong: ${strong}; }`,
      );
    }
  });
});
