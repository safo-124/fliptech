"use client";

import { Loader2, Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { showBasketToast } from "@/components/basket/BasketToast";
import { addToBasket } from "@/lib/basket";
import { cn } from "@/lib/utils";

/** The "+" on a product card: one of it into the basket, a toast, no page
    change. A product that needs a size or colour first opens its page. */
export function QuickAdd({ productId, label, className }: { productId: number; label: string; className?: string }) {
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
