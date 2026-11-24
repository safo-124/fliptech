"use client";

import { CheckCircle2, Info } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

const EVENT = "fliiptech:basket-added";

/** How long the toast stays at the least. It also stays while the pointer is
    on it or something in it has focus, so nobody loses it mid-read. */
const SHOWN_FOR_MS = 5000;

type Shown = { at: number; extra: string; added: boolean };

/**
 * "Added to your basket · View basket", without leaving the page. `added`
 * false means nothing went in (the basket already holds every one left): the
 * message then leads, instead of "Added to your basket".
 */
export function showBasketToast(message?: string, added = true) {
  window.dispatchEvent(new CustomEvent(EVENT, { detail: { message: message ?? "", added } }));
}

/** Mounted once, in the header: says what was added. */
export function BasketToast({ labels }: { labels: { added: string; viewBasket: string } }) {
  const [shown, setShown] = useState<Shown | null>(null);
  // The pointer is over it, or focus is inside it: it waits.
  const [held, setHeld] = useState(false);

  useEffect(() => {
    function onAdded(event: Event) {
      const detail = (event as CustomEvent).detail as { message?: string; added?: boolean } | string;
      const { message = "", added = true } = typeof detail === "string" ? { message: detail } : (detail ?? {});
      setShown({ at: Date.now(), extra: String(message), added: added !== false });
    }
    window.addEventListener(EVENT, onAdded);
    return () => window.removeEventListener(EVENT, onAdded);
  }, []);

  useEffect(() => {
    if (!shown || held) return;
    const timer = window.setTimeout(() => setShown(null), SHOWN_FOR_MS);
    return () => window.clearTimeout(timer);
  }, [shown, held]);

  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 bottom-20 z-[1100] flex justify-center px-4 lg:bottom-6"
    >
      {shown ? (
        <div
          onMouseEnter={() => setHeld(true)}
          onMouseLeave={() => setHeld(false)}
          onFocus={() => setHeld(true)}
          onBlur={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setHeld(false);
          }}
          className="pointer-events-auto flex max-w-sm items-center gap-3 rounded-2xl bg-[var(--color-foreground)] px-4 py-2.5 text-sm text-[var(--color-background)] shadow-[var(--shadow-lg)]"
        >
          {shown.added ? (
            <CheckCircle2 aria-hidden="true" className="size-5 shrink-0 text-[var(--color-visit)]" />
          ) : (
            <Info aria-hidden="true" className="size-5 shrink-0 text-[var(--color-warn,#d9a406)]" />
          )}
          <span className="min-w-0">
            {shown.added ? (
              <>
                {labels.added}
                {shown.extra ? <span className="block text-xs opacity-80">{shown.extra}</span> : null}
              </>
            ) : (
              shown.extra
            )}
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
