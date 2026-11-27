/**
 * The one account everyone has. Browser only. See backend accounts/views.py.
 *
 * Signing in here signs the person in everywhere: being a trainee, trainer or
 * seller hangs off the same login, so their dashboards open without another
 * code.
 */

import {forgetAccountCopies} from "./bag";
import {announceSignedOut} from "./sign-in";
import {clearAllDrafts} from "./drafts";
import {trainerFetch as sessionFetch} from "./trainer-fetch";
import type {MarketplaceOrder} from "./types";

export type RoleState = {
  href: string;
  status?: "pending" | "confirmed" | "declined";
  /** Trainers only: the name staff checked against their ID, once confirmed. */
  checked_name?: string;
} | null;

export type CustomerAccount = {
  phone: string;
  display_name: string;
  email: string | null;
  delivery_address: string;
  /** Their own picture, or null. Only ever shown to them. */
  photo: string | null;
  /** What they said brought them, ticked once after signing up. */
  interests: ("learn" | "teach" | "buy" | "sell")[];
  created_at: string;
  /** False for an account made with a phone code: it can set one. */
  has_password?: boolean;
  email_verified?: boolean;
  /** False for a number given at sign-up and never proven with a code. */
  phone_verified?: boolean;
};

/** Which ways in are offered besides phone or email and a password. */
export type SignInMethods = {code: boolean};

export type AccountSession =
  | {authenticated: false; account: null; roles: null; sign_in?: SignInMethods}
  | {
      authenticated: true;
      account: CustomerAccount;
      roles: {trainee: RoleState; trainer: RoleState; seller: RoleState};
      sign_in?: SignInMethods;
    };

/** Set the account's picture (a file from the browser) or take it off. */
export function setAccountPhoto(file: File) {
  const body = new FormData();
  body.append("photo", file);
  return sessionFetch<AccountSession>("/api/account/photo/", {method: "POST", body});
}

export function removeAccountPhoto() {
  return sessionFetch<AccountSession>("/api/account/photo/", {method: "DELETE"});
}

export function getAccount() {
  return sessionFetch<AccountSession>("/api/account/");
}

/** `intent: "register"` (the Create your account page) is refused with a 409,
 *  `code: "account_exists"`, for a number that already has an account. */
export function requestAccountCode(phone: string, intent?: "register") {
  return sessionFetch<{challenge_id: string; expires_in_seconds: number; code_length?: number}>("/api/account/request-code/", {
    method: "POST",
    body: JSON.stringify(intent ? {phone, intent} : {phone}),
  });
}

export function verifyAccountCode(body: {challenge_id: string; phone: string; code: string; name?: string}) {
  return sessionFetch<AccountSession & {joined: boolean}>("/api/account/verify-code/", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

/** A new account: phone and a password, and an email if they give one
 *  (backend accounts/passwords.py). Signs in; an email gets a link to confirm it. */
export function registerWithPassword(body: {phone: string; email?: string; password: string; name?: string}) {
  return sessionFetch<AccountSession & {joined: boolean}>("/api/account/register/", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

/** `login` is a phone number (however typed) or an email address. */
export function signInWithPassword(login: string, password: string) {
  return sessionFetch<AccountSession & {joined: boolean}>("/api/account/sign-in/", {
    method: "POST",
    body: JSON.stringify({login, password}),
  });
}

/** Emails a link to set a new password. The answer is the same whether or not
 *  the account exists. */
export function forgotPassword(login: string) {
  return sessionFetch<{detail: string}>("/api/account/password/forgot/", {
    method: "POST",
    body: JSON.stringify({login}),
  });
}

/** The link from the email: a new password, and signed in. */
export function resetPassword(body: {uid: string; token: string; password: string}) {
  return sessionFetch<AccountSession>("/api/account/password/reset/", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

/** Set a password (an account made with a code has none) or change it. */
export function setAccountPassword(body: {password: string; current_password?: string}) {
  return sessionFetch<AccountSession>("/api/account/password/", {method: "POST", body: JSON.stringify(body)});
}

export function confirmEmail(body: {uid: string; token: string}) {
  return sessionFetch<{confirmed: boolean; email: string}>("/api/account/email/confirm/", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function resendConfirmEmail() {
  return sessionFetch<{detail: string}>("/api/account/email/resend/", {method: "POST"});
}

export function updateAccount(
  patch: Partial<Pick<CustomerAccount, "display_name" | "email" | "delivery_address" | "interests">>,
) {
  return sessionFetch<AccountSession>("/api/account/", {method: "PATCH", body: JSON.stringify(patch)});
}

export function signOutAccount() {
  // Drafts go whether or not the request succeeds: the person is leaving.
  clearAllDrafts();
  forgetAccountCopies();
  announceSignedOut();
  return sessionFetch<AccountSession>("/api/account/logout/", {method: "POST"});
}

/** Delete the whole login, shop and workshop included (backend
 *  accounts/removal.py). A password account sends its password; a wrong one
 *  is a 403 whose message says so. */
export async function closeAccount(password?: string) {
  const result = await sessionFetch<{closed: true}>("/api/account/close/", {
    method: "POST",
    body: JSON.stringify(password === undefined ? {confirm: true} : {confirm: true, password}),
  });
  clearAllDrafts();
  forgetAccountCopies();
  announceSignedOut();
  return result;
}

export function getMyOrders() {
  return sessionFetch<{results: MarketplaceOrder[]}>("/api/account/orders/");
}

export type MyQuestions = {
  questions: {
    reference: string;
    product: number | null;
    product_name: string;
    seller_name: string;
    message: string;
    created_at: string;
  }[];
  quotes: {
    reference: string;
    title: string;
    trade: string;
    state: "open" | "closed";
    makers: string[];
    created_at: string;
  }[];
};

export function getMyQuestions() {
  return sessionFetch<MyQuestions>("/api/account/questions/");
}

export function getSavedIds() {
  return sessionFetch<{ids: number[]}>("/api/account/saved/");
}

export function changeSaved(body: {add?: number[]; remove?: number[]}) {
  return sessionFetch<{ids: number[]}>("/api/account/saved/", {method: "PUT", body: JSON.stringify(body)});
}

export function addRole(role: "trainee" | "trainer" | "seller") {
  return sessionFetch<AccountSession>(`/api/account/roles/${role}/`, {method: "POST"});
}

/** A marketplace search kept by the account, texted about new matches. */
export type SavedSearch = {
  id: number;
  label: string;
  params: Record<string, string>;
  path: string;
  created_at: string;
  last_told_at: string | null;
};

export function getSavedSearches() {
  return sessionFetch<{results: SavedSearch[]}>("/api/account/searches/");
}

export function saveSearch(params: Record<string, string>, label: string) {
  return sessionFetch<SavedSearch>("/api/account/searches/", {
    method: "POST",
    body: JSON.stringify({params, label}),
  });
}

export function deleteSavedSearch(id: number) {
  return sessionFetch<void>(`/api/account/searches/${id}/`, {method: "DELETE"});
}

/**
 * Chats between a person and a shop or a training workshop. See backend
 * marketplace/chat.py. "buyer" is the person's side whichever it is (a buyer
 * or a trainee); "seller" is the shop's or the workshop's.
 */
export type ChatMessage = {
  id: number;
  sender: "buyer" | "seller";
  /** "enquiry" carries a course card; "phone" is the sender sharing their own number. */
  kind: "text" | "enquiry" | "phone";
  body: string;
  product: {id: number; name: string; price: string | null; photo: string | null} | null;
  course: {
    reference: string;
    title: string;
    fee: string | null;
    starts: string | null;
    /** False once the course is taken down: say so, not a start date. */
    listed: boolean;
  } | null;
  created_at: string;
};

export type ChatSummary = {
  id: number;
  kind: "shop" | "workshop";
  with: {name: string; id: number | null};
  /** The shop or workshop in the chat, and its page on the site. */
  business: {kind: "shop" | "workshop"; id: number; name: string; path: string};
  last: ChatMessage | null;
  unread: number;
  /** The person closed their account: the business keeps the chat to read. */
  closed?: boolean;
  /** This side blocked the other, and may unblock. */
  blocked_by_you?: boolean;
  /** False when either side blocked the other, or the person closed their account. */
  can_write?: boolean;
  last_message_at: string;
};

export type ChatThread = ChatSummary & {messages: ChatMessage[]};

export type ChatReportReason = "scam" | "money" | "abuse" | "other";

/** Share my number: the signed-in person's own phone, into the chat. */
export function shareMyNumber(id: number) {
  return sessionFetch<ChatThread>(`/api/account/chats/${id}/share-number/`, {method: "POST"});
}

/** Block the shop or workshop in this chat (on), or unblock it. */
export function blockChat(id: number, on: boolean) {
  return sessionFetch<ChatThread>(`/api/account/chats/${id}/block/`, {method: on ? "POST" : "DELETE"});
}

/** Block the person in this chat (on), or unblock them, for the whole shop or workshop. */
export function blockInboxChat(id: number, on: boolean) {
  return sessionFetch<ChatThread>(`/api/inbox/${id}/block/`, {method: on ? "POST" : "DELETE"});
}

export function reportChat(id: number, reason: ChatReportReason, details: string) {
  return sessionFetch<{detail: string}>(`/api/account/chats/${id}/report/`, {
    method: "POST",
    body: JSON.stringify({reason, details}),
  });
}

/** One role's count for the floating messages button: messages not yet read,
 * and chats waiting on this login (the other side wrote last). */
export type ChatRole = {role: "buying" | "selling" | "teaching"; unread: number; waiting: number};

/** Which roles this login has in chat, each with its counts; none when signed
 * out or with nothing to show. See backend marketplace/chat.py, UnreadView. */
export function getChatCounts() {
  return sessionFetch<{signed_in: boolean; roles: ChatRole[]}>("/api/chats/unread/");
}

/** The business inbox: every chat for the shop and the workshop this login holds. */
export function getInbox() {
  return sessionFetch<{results: ChatSummary[]}>("/api/inbox/");
}

export function getInboxChat(id: number) {
  return sessionFetch<ChatThread>(`/api/inbox/${id}/`);
}

export function sendInboxChat(id: number, body: string) {
  return sessionFetch<ChatThread>(`/api/inbox/${id}/`, {method: "POST", body: JSON.stringify({body})});
}

export function shareInboxNumber(id: number) {
  return sessionFetch<ChatThread>(`/api/inbox/${id}/share-number/`, {method: "POST"});
}

export function reportInboxChat(id: number, reason: ChatReportReason, details: string) {
  return sessionFetch<{detail: string}>(`/api/inbox/${id}/report/`, {
    method: "POST",
    body: JSON.stringify({reason, details}),
  });
}

/** A seller opening the chat with a paid order's buyer, to write first. */
export function openOrderChat(reference: string) {
  return sessionFetch<ChatThread>("/api/inbox/", {method: "POST", body: JSON.stringify({order: reference})});
}

export function getChats() {
  return sessionFetch<{results: ChatSummary[]}>("/api/account/chats/");
}

export function startChat(seller: number, body: string, product?: number) {
  return sessionFetch<ChatThread>("/api/account/chats/", {
    method: "POST",
    body: JSON.stringify({seller, body, ...(product ? {product} : {})}),
  });
}

export function getChat(id: number) {
  return sessionFetch<ChatThread>(`/api/account/chats/${id}/`);
}

export function sendChat(id: number, body: string) {
  return sessionFetch<ChatThread>(`/api/account/chats/${id}/`, {method: "POST", body: JSON.stringify({body})});
}

/** The bag kept on the account. See backend accounts/views.py BagView. */
export type AccountBagLine = {
  product: number;
  option: number | null;
  option_label: string;
  quantity: number;
  name: string;
  price: string | null;
  photo: string | null;
  seller: {id: number; business_name: string};
  available: boolean;
};

type Line = {product: number; option: number | null; quantity: number};

export function replaceBag(items: Line[]) {
  return sessionFetch<{items: AccountBagLine[]}>("/api/account/bag/", {method: "PUT", body: JSON.stringify({items})});
}

export function addToAccountBag(add: Line[]) {
  return sessionFetch<{items: AccountBagLine[]}>("/api/account/bag/", {method: "POST", body: JSON.stringify({add})});
}

export type SavedAddress = {id: number; label: string; address: string};

export function getAddresses() {
  return sessionFetch<{results: SavedAddress[]}>("/api/account/addresses/");
}

export function deleteAddress(id: number) {
  return sessionFetch<void>(`/api/account/addresses/${id}/`, {method: "DELETE"});
}
