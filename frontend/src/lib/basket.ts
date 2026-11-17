/**
 * The shopping basket, kept on the server (backend marketplace/basket.py)
 * so the website and the app show the same one and every rule is applied
 * there: stock, prices, own items, what is no longer available, totals.
 * Nothing is priced here.
 *
 * Signed out, the server names the basket with a token this browser keeps in
 * local storage and sends as X-Basket-Token. Once the buyer is signed in
 * (verifying a phone at checkout does it), the server merges that basket into
 * the account's and says so ("owner": "account"); the token is then dropped.
 *
 * One copy of the basket is kept in memory for the page, so the header count,
 * the product page and the basket page agree without asking twice.
 */

import {OLD_BAGS} from "./bag";
import {csrfToken, trainerFetch} from "./trainer-fetch";
import type {MarketplaceOrder, PickupPoint, SellerShop} from "./types";

const TOKEN = "fliiptech:basket-token";

export type BasketLine = {
  id: number;
  product: number;
  option: number | null;
  option_label: string;
  name: string;
  photo: string | null;
  unit_price: string | null;
  quantity: number;
  max_quantity: number;
  few_left: number | null;
  line_total: string | null;
  available: boolean;
  unavailable_reason: string;
  made_to_order: {days: number | null; deposit_percent: number | null; deposit: string | null} | null;
  price_changed: {from: string; to: string} | null;
};

export type BasketTotals = {
  subtotal: string;
  discount: string;
  delivery: string;
  total: string;
  pay_now: string;
  balance: string;
  plan: "full" | "deposit" | "collect" | "direct";
};

export type BasketGroup = {
  seller: SellerShop["seller"];
  pickup: PickupPoint | null;
  delivery: {fee: string; area: string} | null;
  takes_payments: boolean;
  lines: BasketLine[];
  subtotal: string;
  total: string;
  totals: {pickup: BasketTotals | null; delivery: BasketTotals | null};
  problem: string;
};

export type Basket = {
  token: string | null;
  owner: "account" | "device" | null;
  count: number;
  groups: BasketGroup[];
  notice: string;
};

export type CheckoutInput = {
  phone: string;
  name: string;
  fulfilment: "pickup" | "delivery";
  note?: string;
  code?: string;
  pay_at_collection?: boolean;
};

export type CheckoutResult =
  | {kind: "pay"; authorization_url: string; reference: string}
  | ({kind: "direct"; conversation_id: number | null} & MarketplaceOrder);

const EMPTY: Basket = {token: null, owner: null, count: 0, groups: [], notice: ""};

let current: Basket | null = null;
const listeners = new Set<() => void>();

function readToken(): string | null {
  try {
    return window.localStorage.getItem(TOKEN);
  } catch {
    return null;
  }
}

function keep(next: Basket) {
  try {
    if (next.token) window.localStorage.setItem(TOKEN, next.token);
    else if (next.owner === "account") window.localStorage.removeItem(TOKEN);
  } catch {
    // Not kept: the basket lasts this visit only.
  }
  current = next;
  for (const listener of listeners) listener();
  return next;
}

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  // A first change from a visitor with no CSRF cookie yet: reading the
  // basket hands one out (and is cheap).
  if ((init.method ?? "GET") !== "GET" && typeof window !== "undefined" && !csrfToken()) {
    await trainerFetch("/api/basket/").catch(() => null);
  }
  const headers = new Headers(init.headers);
  const token = typeof window === "undefined" ? null : readToken();
  if (token) headers.set("X-Basket-Token", token);
  return trainerFetch<T>(path, {...init, headers});
}

/** The last basket this page saw, or null before the first load. */
export function basketSnapshot(): Basket | null {
  return current;
}

export function onBasketChange(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Anything left in the old browser-only bag goes into the server basket,
    once; the old copy is then removed. */
async function importOldBag(): Promise<Basket | null> {
  let old: Record<string, {items: {product: number; option: number | null; quantity: number}[]}> | null = null;
  try {
    const raw = window.localStorage.getItem(OLD_BAGS);
    old = raw ? JSON.parse(raw) : null;
    window.localStorage.removeItem(OLD_BAGS);
  } catch {
    return null;
  }
  let last: Basket | null = null;
  for (const bag of Object.values(old ?? {})) {
    for (const item of bag.items ?? []) {
      last = await addToBasket(item.product, item.option, item.quantity).catch(() => last);
    }
  }
  return last;
}

export async function loadBasket(): Promise<Basket> {
  // Nothing to ask for: signed out with no basket yet. (Signed in, the
  // server has the account's, so ask whenever there is a session.)
  const imported = typeof window === "undefined" ? null : await importOldBag();
  if (imported) return imported;
  if (!readToken() && !csrfToken()) return keep(EMPTY);
  return keep(await call<Basket>("/api/basket/"));
}

export async function addToBasket(product: number, option: number | null, quantity: number) {
  return keep(
    await call<Basket>("/api/basket/items/", {
      method: "POST",
      body: JSON.stringify({product, option, quantity}),
    }),
  );
}

export async function setLineQuantity(lineId: number, quantity: number) {
  return keep(
    await call<Basket>(`/api/basket/items/${lineId}/`, {
      method: "PATCH",
      body: JSON.stringify({quantity}),
    }),
  );
}

export async function removeLine(lineId: number) {
  return keep(await call<Basket>(`/api/basket/items/${lineId}/`, {method: "DELETE"}));
}

export async function clearBasket() {
  return keep(await call<Basket>("/api/basket/", {method: "DELETE"}));
}

/** After signing in: the server merges this browser's basket into the
    account's on the next request that carries the token. */
export async function mergeBasketAfterSignIn() {
  return loadBasket().catch(() => current ?? EMPTY);
}

/** Check out one seller's group. A changed price comes back as an error
    whose body carries the basket with the change marked; it is kept, so
    the page shows "Price changed from GH₵X to GH₵Y". */
export async function checkoutSeller(sellerId: number, input: CheckoutInput): Promise<CheckoutResult> {
  try {
    return await call<CheckoutResult>(`/api/basket/checkout/${sellerId}/`, {
      method: "POST",
      body: JSON.stringify(input),
    });
  } catch (error) {
    const body = (error as {body?: unknown}).body as {basket?: Basket} | null;
    if (body?.basket) keep(body.basket);
    throw error;
  }
}

export function groupFor(basket: Basket | null, sellerId: number) {
  return basket?.groups.find((group) => group.seller.id === sellerId) ?? null;
}
