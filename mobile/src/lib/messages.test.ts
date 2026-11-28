import { firstTab, forTab, inOrder, topicOf, totalUnread, type ChatRole } from "./messages";
import type { ChatSummary } from "./types";

const role = (name: ChatRole["role"], unread = 0, waiting = 0): ChatRole => ({ role: name, unread, waiting });

function chat(id: number, fields: Partial<ChatSummary> & { from?: "buyer" | "seller" } = {}): ChatSummary {
  const { from = "seller", ...rest } = fields;
  return {
    id,
    kind: "shop",
    with: { name: `Chat ${id}`, id: null },
    business: { kind: "shop", id: 1, name: "Shop", path: "/marketplace/seller/1" },
    last: { id, sender: from, kind: "text", body: "Hello", product: null, course: null, created_at: "2026-11-27T10:00:00Z" },
    unread: 0,
    can_write: true,
    last_message_at: `2026-11-2${id}T10:00:00Z`,
    ...rest,
  } as ChatSummary;
}

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
  it("lists roles as buying, selling, teaching and adds up the unread", () => {
    const roles = [role("teaching", 1), role("buying", 2), role("selling")];
    expect(inOrder(roles).map((entry) => entry.role)).toEqual(["buying", "selling", "teaching"]);
    expect(totalUnread(roles)).toBe(3);
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

  it("tags a chat with the product it is about", () => {
    const about = chat(1);
    about.last = { ...about.last!, product: { id: 5, name: "Woven basket", price: null, photo: null } } as ChatSummary["last"];
    expect(topicOf(about)).toBe("Woven basket");
    expect(topicOf(chat(2))).toBeNull();
  });
});
