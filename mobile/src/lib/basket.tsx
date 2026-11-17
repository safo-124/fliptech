import { useQuery, useQueryClient } from "@tanstack/react-query";
import * as SecureStore from "expo-secure-store";
import { createContext, useCallback, useContext, useEffect, useMemo, type ReactNode } from "react";
import { AppState, Platform } from "react-native";

import { ApiError, request } from "./api";
import { useAuth } from "./auth";
import type { Order, PickupPoint, ShopDetail } from "./types";

/**
 * The shopping basket, kept on the server (backend marketplace/basket.py),
 * the same one the website shows, with every rule applied there: stock,
 * prices, own items, what is no longer available, the totals. Nothing is
 * priced on the phone.
 *
 * Signed out, the server names the basket with a token kept in the phone's
 * secure storage and sent as X-Basket-Token. Once the buyer is signed in
 * (the code at checkout does it), the server merges that basket into the
 * account's and says so ("owner": "account"); the token is then forgotten.
 *
 * The basket is a query like any other, so the app's saved answers keep it
 * for viewing offline; it is asked again whenever the app comes back to the
 * front.
 */

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
  made_to_order: { days: number | null; deposit_percent: number | null; deposit: string | null } | null;
  price_changed: { from: string; to: string } | null;
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
  seller: ShopDetail["seller"];
  pickup: PickupPoint | null;
  delivery: { fee: string; area: string } | null;
  takes_payments: boolean;
  lines: BasketLine[];
  subtotal: string;
  total: string;
  totals: { pickup: BasketTotals | null; delivery: BasketTotals | null };
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
  | { kind: "pay"; authorization_url: string; reference: string }
  | ({ kind: "direct"; conversation_id: number | null } & Order);

export const EMPTY_BASKET: Basket = { token: null, owner: null, count: 0, groups: [], notice: "" };
const KEY = "fliiptech.basket-token";
const secure = Platform.OS !== "web";
let deviceToken: string | null = null;
let tokenRead: Promise<void> | null = null;

function readToken() {
  tokenRead ??= (async () => {
    if (!secure) return;
    try {
      deviceToken = await SecureStore.getItemAsync(KEY);
    } catch {
      deviceToken = null;
    }
  })();
  return tokenRead;
}

async function writeToken(value: string | null) {
  deviceToken = value;
  if (!secure) return;
  try {
    if (value) await SecureStore.setItemAsync(KEY, value);
    else await SecureStore.deleteItemAsync(KEY);
  } catch {
    // Kept in memory for this run.
  }
}

/** One call to the basket API, with the device's token when it has one. */
export async function basketCall<T>(
  method: "GET" | "POST" | "PATCH" | "DELETE",
  path: string,
  body?: unknown,
): Promise<T> {
  await readToken();
  return request<T>(method, path, {
    body,
    headers: deviceToken ? { "X-Basket-Token": deviceToken } : {},
  });
}

/** Keep (or forget) the device token a basket answer carries. */
async function kept(basket: Basket) {
  if (basket.token) await writeToken(basket.token);
  else if (basket.owner === "account" && deviceToken) await writeToken(null);
  return basket;
}

export const basketApi = {
  get: async () => kept(await basketCall<Basket>("GET", "/api/basket/")),
  add: async (product: number, option: number | null, quantity: number) =>
    kept(await basketCall<Basket>("POST", "/api/basket/items/", { product, option, quantity })),
  setQuantity: async (line: number, quantity: number) =>
    kept(await basketCall<Basket>("PATCH", `/api/basket/items/${line}/`, { quantity })),
  remove: async (line: number) => kept(await basketCall<Basket>("DELETE", `/api/basket/items/${line}/`)),
  clear: async () => kept(await basketCall<Basket>("DELETE", "/api/basket/")),
  checkout: (seller: number, input: CheckoutInput) =>
    basketCall<CheckoutResult>("POST", `/api/basket/checkout/${seller}/`, input),
};

type BasketContextValue = {
  basket: Basket | undefined;
  count: number;
  loading: boolean;
  refresh: () => Promise<unknown>;
  add: (product: number, option: number | null, quantity: number) => Promise<Basket>;
  setQuantity: (line: number, quantity: number) => Promise<Basket>;
  remove: (line: number) => Promise<Basket>;
  clear: () => Promise<Basket>;
  /** Check out one seller's group; a changed price comes back as an
      ApiError, and the basket it carries (with the change marked) is kept. */
  checkout: (seller: number, input: CheckoutInput) => Promise<CheckoutResult>;
};

const BasketContext = createContext<BasketContextValue | null>(null);

export function BasketProvider({ children }: { children: ReactNode }) {
  const client = useQueryClient();
  const { signedIn, ready } = useAuth();
  const query = useQuery({ queryKey: ["basket"], queryFn: basketApi.get, enabled: ready, staleTime: 30_000 });
  const { refetch } = query;

  const set = useCallback(
    (basket: Basket) => {
      client.setQueryData(["basket"], basket);
      return basket;
    },
    [client],
  );

  // Signed in (or out): ask again; signing in merges this phone's basket.
  useEffect(() => {
    if (ready) void refetch();
  }, [signedIn, ready, refetch]);

  // Back in the app: the count may have changed on the website.
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") void refetch();
    });
    return () => subscription.remove();
  }, [refetch]);

  const value = useMemo<BasketContextValue>(
    () => ({
      basket: query.data,
      count: query.data?.count ?? 0,
      loading: query.isPending,
      refresh: refetch,
      add: async (product, option, quantity) => set(await basketApi.add(product, option, quantity)),
      setQuantity: async (line, quantity) => set(await basketApi.setQuantity(line, quantity)),
      remove: async (line) => set(await basketApi.remove(line)),
      clear: async () => set(await basketApi.clear()),
      checkout: async (seller, input) => {
        try {
          const result = await basketApi.checkout(seller, input);
          void refetch();
          return result;
        } catch (error) {
          const body = error instanceof ApiError ? (error.body as { basket?: Basket } | null) : null;
          if (body?.basket) set(body.basket);
          throw error;
        }
      },
    }),
    [query.data, query.isPending, refetch, set],
  );
  return <BasketContext.Provider value={value}>{children}</BasketContext.Provider>;
}

export function useBasket() {
  const basket = useContext(BasketContext);
  if (!basket) throw new Error("useBasket outside BasketProvider");
  return basket;
}

export function groupFor(basket: Basket | undefined, sellerId: number) {
  return basket?.groups.find((group) => group.seller.id === sellerId) ?? null;
}
