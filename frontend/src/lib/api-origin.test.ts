import {describe, expect, it} from "vitest";

import {alignLoopbackHost} from "./api-origin";

describe("alignLoopbackHost", () => {
  it("follows the page when it was opened on localhost", () => {
    expect(alignLoopbackHost("http://127.0.0.1:8000", "localhost")).toBe("http://localhost:8000");
  });

  it("follows the page when it was opened on 127.0.0.1", () => {
    expect(alignLoopbackHost("http://localhost:8000", "127.0.0.1")).toBe("http://127.0.0.1:8000");
  });

  it("leaves a matching host alone", () => {
    expect(alignLoopbackHost("http://127.0.0.1:8000", "127.0.0.1")).toBe("http://127.0.0.1:8000");
  });

  it("never touches a real domain", () => {
    expect(alignLoopbackHost("https://skills.example", "localhost")).toBe("https://skills.example");
    expect(alignLoopbackHost("http://127.0.0.1:8000", "skills.example")).toBe("http://127.0.0.1:8000");
  });

  it("keeps an empty same-origin setting", () => {
    expect(alignLoopbackHost("", "localhost")).toBe("");
  });
});
