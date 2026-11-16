import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";

import {addToBasket, basketSnapshot, checkoutSeller, loadBasket, setLineQuantity} from "./basket";

class MemoryStorage {
  private items = new Map<string, string>();
  getItem(key: string) {
    return this.items.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.items.set(key, value);
  }
  removeItem(key: string) {
    this.items.delete(key);
  }
}

function jsonResponse(body: unknown, status = 200) {
  return Promise.resolve(
    new Response(JSON.stringify(body), {status, headers: {"Content-Type": "application/json"}}),
  );
}

const empty = {token: null, owner: "device", count: 0, groups: [], notice: ""};
let storage: MemoryStorage;

beforeEach(() => {
  storage = new MemoryStorage();
  vi.stubGlobal("window", Object.assign(new EventTarget(), {localStorage: storage}));
  vi.stubGlobal("document", {cookie: "csrftoken=tok"});
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function headersOf(call: unknown) {
  const [, init] = call as [string, RequestInit];
  return new Headers(init.headers);
}

describe("the basket client", () => {
  it("keeps the device token the server hands out and sends it back", async () => {
    const fetchMock = vi.fn((url: string) =>
      url.endsWith("/api/basket/items/")
        ? jsonResponse({...empty, token: "dev-token", count: 2})
        : jsonResponse({...empty, count: 2}),
    );
    vi.stubGlobal("fetch", fetchMock);

    const added = await addToBasket(5, null, 2);
    await loadBasket();

    expect(added.count).toBe(2);
    expect(storage.getItem("fliiptech:basket-token")).toBe("dev-token");
    expect(headersOf(fetchMock.mock.calls[1]).get("X-Basket-Token")).toBe("dev-token");
  });

  it("forgets the token once the basket belongs to the account", async () => {
    storage.setItem("fliiptech:basket-token", "dev-token");
    vi.stubGlobal("fetch", vi.fn(() => jsonResponse({...empty, owner: "account", count: 3})));

    await loadBasket();

    expect(storage.getItem("fliiptech:basket-token")).toBeNull();
    expect(basketSnapshot()?.count).toBe(3);
  });

  it("sends a quantity change as the server's line id", async () => {
    const fetchMock = vi.fn(() => jsonResponse(empty));
    vi.stubGlobal("fetch", fetchMock);

    await setLineQuantity(42, 3);

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toMatch(/\/api\/basket\/items\/42\/$/);
    expect(init.method).toBe("PATCH");
    expect(init.body).toBe(JSON.stringify({quantity: 3}));
  });

  it("keeps the basket a changed price came back with, to show it", async () => {
    const flagged = {
      ...empty,
      count: 1,
      groups: [{seller: {id: 7}, lines: [{id: 1, price_changed: {from: "10.00", to: "12.00"}}]}],
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(() => jsonResponse({detail: "A price changed.", code: "price_changed", basket: flagged}, 409)),
    );

    await expect(
      checkoutSeller(7, {phone: "+233241234567", name: "Esi", fulfilment: "pickup"}),
    ).rejects.toThrow("A price changed.");

    expect(basketSnapshot()?.groups[0].lines[0].price_changed).toEqual({from: "10.00", to: "12.00"});
  });
});
