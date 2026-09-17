import {afterEach, describe, expect, it, vi} from "vitest";

import {postJson, searchAllProviders} from "./api";
import type {ProviderCard} from "./types";

function provider(id: number): ProviderCard {
  return {
    id,
    name: `Provider ${id}`,
    slug: `provider-${id}`,
    area: "Accra",
    area_slug: "accra",
    region: "Greater Accra",
    lowest_fee: "500.00",
    shortest_duration_weeks: 8,
    next_intake: null,
    distance_m: null,
    site_visit: null,
    government_status: {registration_status: "not_claimed", label: "Not claimed"},
    primary_photo: null,
    logo: null,
    lat: 5.6037,
    lng: -0.187,
    listing_confirmed_on: null,
    is_stale: false,
  };
}

function jsonPage(body: unknown) {
  return Promise.resolve(
    new Response(JSON.stringify(body), {
      status: 200,
      headers: {"Content-Type": "application/json"},
    }),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("searchAllProviders", () => {
  it("follows every API page through the configured internal origin", async () => {
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(() =>
        jsonPage({
          count: 2,
          next: "https://public.example/api/providers/?page=2",
          previous: null,
          results: [provider(1)],
        }),
      )
      .mockImplementationOnce(() =>
        jsonPage({
          count: 2,
          next: null,
          previous: "https://public.example/api/providers/",
          results: [provider(2)],
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    await expect(searchAllProviders()).resolves.toEqual([provider(1), provider(2)]);
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "http://127.0.0.1:8000/api/providers/?page=2",
      expect.any(Object),
    );
  });

  it("rejects an incomplete final page instead of drawing a partial map", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        jsonPage({count: 2, next: null, previous: null, results: [provider(1)]}),
      ),
    );

    await expect(searchAllProviders()).rejects.toMatchObject({
      message: "API returned an incomplete collection",
      status: 502,
    });
  });

  it("rejects duplicate rows across pages", async () => {
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(() =>
        jsonPage({
          count: 2,
          next: "http://api.example/api/providers/?page=2",
          previous: null,
          results: [provider(1)],
        }),
      )
      .mockImplementationOnce(() =>
        jsonPage({
          count: 2,
          next: null,
          previous: "http://api.example/api/providers/",
          results: [provider(1)],
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    await expect(searchAllProviders()).rejects.toMatchObject({
      message: "API returned duplicate providers across pages",
      status: 502,
    });
  });
});

describe("postJson", () => {
  it("sends the session cookie and echoes the CSRF token when one exists", async () => {
    const fetchMock = vi.fn(() => jsonPage({verified: true}));
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("document", {cookie: "theme=dark; csrftoken=abc%3D123"});

    await postJson("/api/enquiries/", {phone: "+233241112222"});

    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:8000/api/enquiries/",
      expect.objectContaining({
        credentials: "include",
        headers: {"Content-Type": "application/json", "X-CSRFToken": "abc=123"},
      }),
    );
  });

  it("sends no token for an anonymous visitor", async () => {
    const fetchMock = vi.fn(() => jsonPage({verified: false}));
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("document", {cookie: ""});

    await postJson("/api/enquiries/request-code/", {phone: "+233241112222"});

    expect(fetchMock).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({headers: {"Content-Type": "application/json"}}),
    );
  });
});
