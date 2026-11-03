/**
 * One checkout for the whole bag: each seller is paid separately (the money
 * goes to them), but the buyer fills in their details once. The sellers
 * still to pay wait here, in this tab, while Paystack takes the first; the
 * order page then offers "Next: pay Kofi (2 of 3)".
 */

import type {BagItem} from "./types";

const KEY = "fliiptech:checkout-queue";

export type QueuedSeller = {sellerId: number; sellerName: string; items: BagItem[]};
export type PaymentQueue = {
  details: {phone: string; name: string; fulfilment: "pickup" | "delivery"; note: string};
  sellers: QueuedSeller[];
  /** How many sellers the whole checkout has, for "2 of 3". */
  total?: number;
};

export function savePaymentQueue(queue: PaymentQueue | null) {
  try {
    if (!queue || !queue.sellers.length) window.sessionStorage.removeItem(KEY);
    else window.sessionStorage.setItem(KEY, JSON.stringify({...queue, total: queue.total ?? queue.sellers.length + 1}));
  } catch {
    // Not kept: the buyer pays the next seller from the bag instead.
  }
}

export function readPaymentQueue(): PaymentQueue | null {
  try {
    const raw = window.sessionStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as PaymentQueue) : null;
  } catch {
    return null;
  }
}
