"use client";

import { CheckCircle2 } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

const EVENT = "fliiptech:basket-added";

/** "Added to your basket · View basket", without leaving the page. */
export function showBasketToast(message?: string) {
  window.dispatchEvent(new CustomEvent(EVENT, { detail: message ?? "" }));
}

/** Mounted once, in the header: says what was added for a few seconds. */
export function BasketToast({ labels }: { labels: { added: string; viewBasket: string } }) {
  const [shown, setShown] = useState<{ at: number; extra: string } | null>(null);

  useEffect(() => {
    function onAdded(event: Event) {
      setShown({ at: Date.now(), extra: String((event as CustomEvent).detail ?? "") });
    }
    window.addEventListener(EVENT, onAdded);
    return () => window.removeEventListener(EVENT, onAdded);
  }, []);

  useEffect(() => {
    if (!shown) return;
    const timer = window.setTimeout(() => setShown(null), 4000);
    return () => window.clearTimeout(timer);
  }, [shown]);

  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 bottom-20 z-[1100] flex justify-center px-4 lg:bottom-6"
    >
      {shown ? (
        <div className="pointer-events-auto flex max-w-sm items-center gap-3 rounded-2xl bg-[var(--color-foreground)] px-4 py-2.5 text-sm text-[var(--color-background)] shadow-[var(--shadow-lg)]">
          <CheckCircle2 aria-hidden="true" className="size-5 shrink-0 text-[var(--color-visit)]" />
          <span className="min-w-0">
            {labels.added}
            {shown.extra ? <span className="block text-xs opacity-80">{shown.extra}</span> : null}
          </span>
          <Link
            href="/marketplace/basket"
            className="inline-flex min-h-11 shrink-0 items-center font-bold underline-offset-2 hover:underline"
          >
            {labels.viewBasket}
          </Link>
        </div>
      ) : null}
    </div>
  );
}
