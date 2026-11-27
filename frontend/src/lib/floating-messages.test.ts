import { describe, expect, it } from "vitest";

import type { ChatRole, ChatSummary } from "./account-api";
import { firstTab, forTab, hiddenOn, inOrder, topicOf, withCount } from "./floating-messages";

const role = (name: ChatRole["role"], unread = 0, waiting = 0): ChatRole => ({ role: name, unread, waiting });

function chat(id: number, fields: Partial<ChatSummary> & { from?: "buyer" | "seller" } = {}): ChatSummary {
  const { from = "seller", ...rest } = fields;
  return {
    id,
    kind: "shop",
    with: { name: `Chat ${id}`, id: null },
    business: { kind: "shop", id: 1, name: "Shop", path: "/marketplace/seller/1" },
    last: {
      id,
      sender: from,
      kind: "text",
      body: "Hello",
      product: null,
      course: null,
      created_at: "2026-11-27T10:00:00Z",
    },
    unread: 0,
    can_write: true,
    last_message_at: `2026-11-2${id}T10:00:00Z`,
    ...rest,
  };
}

describe("hiddenOn", () => {
  it("stays away from the chats, paying, the map and a lesson playing", () => {
    for (const path of ["/inbox", "/inbox/4", "/account/chats/9", "/map", "/marketplace/checkout/3", "/trainer/join", "/learn/accra/braids"]) {
      expect(hiddenOn(path)).toBe(true);
    }
  });

  it("shows everywhere else, the course list and saved lessons included", () => {
    for (const path of ["/", "/marketplace", "/learn", "/learn/mine", "/learn/saved", "/account", "/trainer/dashboard"]) {
      expect(hiddenOn(path)).toBe(false);
    }
  });
});

describe("firstTab", () => {
  it("opens where people wait on a reply, shop first, before a buyer's news", () => {
    expect(firstTab([role("buying", 3, 3), role("teaching", 1, 1)], null)).toBe("teaching");
    expect(firstTab([role("buying", 3, 3), role("selling", 0, 1), role("teaching", 0, 1)], null)).toBe("selling");
  });

  it("then buying with something unread, then the tab used last, then the first", () => {
    expect(firstTab([role("buying", 2), role("selling")], "selling")).toBe("buying");
    expect(firstTab([role("buying"), role("selling")], "selling")).toBe("selling");
    expect(firstTab([role("teaching"), role("buying")], null)).toBe("buying");
    expect(firstTab([], null)).toBeNull();
  });
});

describe("tabs", () => {
  it("lists roles as buying, selling, teaching", () => {
    expect(inOrder([role("teaching"), role("buying"), role("selling")]).map((entry) => entry.role)).toEqual([
      "buying",
      "selling",
      "teaching",
    ]);
  });

  it("splits the inbox into the shop's and the workshop's, those waiting on you first", () => {
    const chats = [
      chat(1, { from: "buyer" }),
      chat(2, { from: "seller" }),
      chat(3, { kind: "workshop", from: "buyer" }),
      chat(4, { from: "buyer", closed: true }),
    ];
    expect(forTab(chats, "selling").map((entry) => entry.id)).toEqual([1, 4, 2]);
    expect(forTab(chats, "teaching").map((entry) => entry.id)).toEqual([3]);
  });

  it("puts a buyer's unread chats first", () => {
    expect(forTab([chat(1, { unread: 1 }), chat(2)], "buying").map((entry) => entry.id)).toEqual([1, 2]);
  });

  it("tags a chat with the product or the course it is about", () => {
    const about = chat(1);
    about.last = { ...about.last!, product: { id: 5, name: "Woven basket", price: null, photo: null } };
    expect(topicOf(about)).toBe("Woven basket");
    expect(topicOf(chat(2))).toBeNull();
  });
});

describe("withCount", () => {
  it("puts the count in front of the title once, and takes it off at none", () => {
    expect(withCount("Fliiptech", 2)).toBe("(2) Fliiptech");
    expect(withCount("(2) Fliiptech", 5)).toBe("(5) Fliiptech");
    expect(withCount("(5) Fliiptech", 0)).toBe("Fliiptech");
  });
});
