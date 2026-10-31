"use client";

import { useEffect } from "react";

import { browserApiUrl } from "@/lib/api-origin";

/**
 * Tells the API this product page was opened, for the seller's numbers.
 * The same arrangement as ProfileViewBeacon: the page is cached, so the
 * browser reports the view; the server counts each visitor once a day.
 */
export function ProductViewBeacon({ productId }: { productId: number }) {
  useEffect(() => {
    const url = `${browserApiUrl()}/api/products/${productId}/viewed/`;
    try {
      if (navigator.sendBeacon?.(url)) return;
    } catch {
      // Some browsers throw on a cross-origin beacon; fall through to fetch.
    }
    fetch(url, { method: "POST", credentials: "include", keepalive: true }).catch(() => {});
  }, [productId]);

  return null;
}
