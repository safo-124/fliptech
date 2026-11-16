"use client";

import { ShoppingBasket } from "lucide-react";
import Link from "next/link";

import { BasketToast } from "@/components/basket/BasketToast";
import { useBasket } from "@/components/basket/useBasket";

/** The basket in the header, with how many things are in it. */
export function BasketLink({ labels }: { labels: { basket: string; added: string; viewBasket: string } }) {
  const count = useBasket()?.count ?? 0;
  return (
    <>
      <Link
        href="/marketplace/basket"
        aria-label={count ? `${labels.basket} (${count})` : labels.basket}
        className="relative grid size-11 shrink-0 place-items-center rounded-full transition-colors hover:bg-[var(--color-brand-soft)]"
      >
        <ShoppingBasket aria-hidden className="size-5 text-[var(--color-brand)]" />
        {count ? (
          <span
            aria-hidden
            className="absolute -right-0.5 -top-0.5 grid min-w-5 place-items-center rounded-full bg-[var(--color-brand-pink)] px-1 text-[11px] font-bold leading-5 text-white"
          >
            {count > 99 ? "99+" : count}
          </span>
        ) : null}
      </Link>
      <BasketToast labels={labels} />
    </>
  );
}
