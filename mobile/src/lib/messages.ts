/**
 * The rules behind Messages in the app (app/messages.tsx, the count on the
 * Me tab and the eyes on Home), the same as the website's floating messages
 * button (frontend lib/floating-messages.ts).
 *
 * A login can be up to three things in chat: a person buying or asking
 * (buying), a shop (selling) and a training workshop (teaching). See backend
 * marketplace/chat.py, UnreadView.
 */

import type { ChatSummary } from "./types";

export type Role = "buying" | "selling" | "teaching";
export type ChatRole = { role: Role; unread: number; waiting: number };

/** The tabs' order: what I buy, what I sell, what I teach. */
export const ROLE_ORDER: Role[] = ["buying", "selling", "teaching"];

export const ROLE_LABEL: Record<Role, string> = { buying: "Buying", selling: "Selling", teaching: "Teaching" };

export function inOrder(roles: ChatRole[]): ChatRole[] {
  return [...roles].sort((a, b) => ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role));
}

/** Which tab opens: people waiting on a reply (the shop, then the workshop),
 * then buying with something unread, then the tab used last, then the first. */
export function firstTab(roles: ChatRole[], last: Role | null): Role | null {
  if (!roles.length) return null;
  const find = (role: Role) => roles.find((entry) => entry.role === role);
  for (const role of ["selling", "teaching"] as const) {
    if ((find(role)?.waiting ?? 0) > 0) return role;
  }
  if ((find("buying")?.unread ?? 0) > 0) return "buying";
  if (last && find(last)) return last;
  return inOrder(roles)[0].role;
}

/** This chat waits on you: unread news for a buyer; for a business, the
 * person wrote last and can still be answered. */
export function waitsOnYou(chat: ChatSummary, role: Role): boolean {
  if (role === "buying") return chat.unread > 0;
  return chat.last?.sender === "buyer" && !chat.closed && chat.can_write !== false;
}

/** One tab's chats: the shop's or the workshop's out of the inbox, or all of
 * a buyer's; those waiting on you first, then the newest. */
export function forTab(chats: ChatSummary[], role: Role): ChatSummary[] {
  const kind = role === "selling" ? "shop" : role === "teaching" ? "workshop" : null;
  const mine = kind ? chats.filter((chat) => chat.kind === kind) : chats;
  return [...mine].sort(
    (a, b) =>
      Number(waitsOnYou(b, role)) - Number(waitsOnYou(a, role)) ||
      (b.last_message_at ?? "").localeCompare(a.last_message_at ?? ""),
  );
}

/** What a chat is about, for its tag: the product or the course last
 * mentioned in it, if any. */
export function topicOf(chat: ChatSummary): string | null {
  return chat.last?.product?.name ?? chat.last?.course?.title ?? null;
}

export function totalUnread(roles: ChatRole[]): number {
  return roles.reduce((sum, role) => sum + role.unread, 0);
}
