"use client";

import { Loader2, Plus, ShoppingCart } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { showBasketToast } from "@/components/basket/BasketToast";
import { addToBasket } from "@/lib/basket";
import { cn } from "@/lib/utils";

/** One of it into the basket, a toast, no page change: the "+" on a card, or
    with `text` a full "Buy" button. A product that needs a size or colour
    first opens its page. */
export function QuickAdd({
  productId,
  label,
  className,
  text,
}: {
  productId: number;
  label: string;
  className?: string;
  /** Shown on the button beside a cart; without it, the round "+". */
  text?: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function add() {
    setBusy(true);
    try {
      const basket = await addToBasket(productId, null, 1);
      showBasketToast(basket.notice || undefined, basket.added !== 0);
    } catch {
      // Needs a size or colour, sold out, or your own: the product page
      // says which.
      router.push(`/marketplace/${productId}`);
    }
    setBusy(false);
  }

  if (text) {
    return (
      <button
        type="button"
        onClick={() => void add()}
        disabled={busy}
        aria-label={label}
        className={cn(
          "inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-[var(--color-brand)] px-4 text-[0.9375rem] font-semibold text-white transition-transform active:scale-[0.98] disabled:opacity-60",
          className,
        )}
      >
        {busy ? <Loader2 aria-hidden="true" className="size-5 animate-spin" /> : <ShoppingCart aria-hidden="true" className="size-5" />}
        {text}
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={() => void add()}
      disabled={busy}
      aria-label={label}
      className={cn(
        "grid size-11 place-items-center rounded-full bg-[var(--color-brand)] text-white shadow-[var(--shadow-lg)] transition-transform active:scale-95 disabled:opacity-60",
        className,
      )}
    >
      {busy ? <Loader2 aria-hidden="true" className="size-5 animate-spin" /> : <Plus aria-hidden="true" className="size-5" />}
    </button>
  );
}
