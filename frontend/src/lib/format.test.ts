import {describe, expect, it} from "vitest";

import {formatCedis} from "./format";

describe("formatCedis", () => {
  it("writes whole cedis without pesewas", () => {
    expect(formatCedis("150.00")).toBe("GH₵150");
  });

  it("never rounds away the pesewas someone will pay", () => {
    expect(formatCedis("149.50")).toBe("GH₵149.50");
  });
});
