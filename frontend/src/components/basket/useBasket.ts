"use client";

import { useEffect, useSyncExternalStore } from "react";

import { basketSnapshot, loadBasket, onBasketChange, type Basket } from "@/lib/basket";

let loading: Promise<unknown> | null = null;

/** The basket every component on the page shares; loaded once, then kept
    up to date by every change made through lib/basket. */
export function useBasket(): Basket | null {
  const basket = useSyncExternalStore(onBasketChange, basketSnapshot, () => null);
  useEffect(() => {
    if (basketSnapshot() || loading) return;
    loading = loadBasket()
      .catch(() => null)
      .finally(() => {
        loading = null;
      });
  }, []);
  return basket;
}
