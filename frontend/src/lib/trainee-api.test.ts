import {afterEach, describe, expect, it, vi} from "vitest";

import {getTraineeSession, safeNextPath, saveProvider} from "./trainee-api";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("safeNextPath", () => {
  it("keeps same-site paths", () => {
    expect(safeNextPath("/accra/accra-welding-works")).toBe("/accra/accra-welding-works");
  });

  it.each([null, "", "https://evil.example", "//evil.example", "/\\evil.example", "trainee"])(
    "falls back to the account page for %s",
    (value) => {
      expect(safeNextPath(value)).toBe("/trainee");
    },
  );
});

describe("trainee requests", () => {
  it("reads the session with the cookie", async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify({authenticated: false, account: null, support: null}), {status: 200}),
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(getTraineeSession()).resolves.toMatchObject({authenticated: false});
    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:8000/api/trainee/session/me/",
      expect.objectContaining({credentials: "include"}),
    );
  });

  it("echoes the CSRF token when saving a provider", async () => {
    const fetchMock = vi.fn<(url: string, init: RequestInit) => Promise<Response>>(() =>
      Promise.resolve(new Response(JSON.stringify({}), {status: 201})),
    );
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("document", {cookie: "csrftoken=tok"});

    await saveProvider(7);

    const init = fetchMock.mock.calls[0][1];
    expect(new Headers(init.headers).get("X-CSRFToken")).toBe("tok");
    expect(init.body).toBe(JSON.stringify({provider_id: 7}));
  });
});
