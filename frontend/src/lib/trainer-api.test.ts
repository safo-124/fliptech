import {afterEach, describe, expect, it, vi} from "vitest";

import {saveTrainerProfile, TrainerApiError} from "./trainer-api";

afterEach(() => {
  vi.unstubAllGlobals();
});

function jsonResponse(body: unknown, status = 200) {
  return Promise.resolve(
    new Response(JSON.stringify(body), {
      status,
      headers: {"Content-Type": "application/json"},
    }),
  );
}

describe("trainer API client", () => {
  it("uses the HttpOnly session and sends Django's CSRF token on writes", async () => {
    vi.stubGlobal("document", {cookie: "theme=light; csrftoken=csrf%20value"});
    const fetchMock = vi.fn(() => jsonResponse({profile: {id: 1}}));
    vi.stubGlobal("fetch", fetchMock);

    await saveTrainerProfile({name: "Workshop"});

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("http://127.0.0.1:8000/api/trainer/profile/");
    expect(init.credentials).toBe("include");
    expect(new Headers(init.headers).get("X-CSRFToken")).toBe("csrf value");
    expect(init.cache).toBe("no-store");
  });

  it("preserves nested DRF field errors for the form", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        jsonResponse(
          {programme: {fee: ["Enter a valid amount."], intake: {start_date: ["Use a future date."]}}},
          400,
        ),
      ),
    );

    const error = await saveTrainerProfile({}).catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(TrainerApiError);
    expect((error as TrainerApiError).fields).toEqual({
      "programme.fee": "Enter a valid amount.",
      "programme.intake.start_date": "Use a future date.",
    });
  });
});
