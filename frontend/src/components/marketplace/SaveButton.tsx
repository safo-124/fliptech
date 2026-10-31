"use client";

import { Heart } from "lucide-react";
import { useEffect, useState } from "react";

import { onBagChange, savedIds, toggleSaved } from "@/lib/bag";

/**
 * Save for later: a heart, kept in this browser (lib/bag.ts). No account.
 * Labels come as props so a list of tiles ships no message catalogue.
 */
export function SaveButton({
  productId,
  labels,
  className = "",
}: {
  productId: number;
  labels: { save: string; saved: string };
  className?: string;
}) {
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    const sync = () => setSaved(savedIds().includes(productId));
    sync();
    return onBagChange(sync);
  }, [productId]);

  return (
    <button
      type="button"
      aria-pressed={saved}
      aria-label={saved ? labels.saved : labels.save}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        setSaved(toggleSaved(productId));
      }}
      className={`grid size-11 place-items-center rounded-full bg-[var(--color-card)]/90 shadow-sm ${className}`}
    >
      <Heart
        aria-hidden="true"
        className={`size-5 ${saved ? "fill-[var(--color-brand-pink)] text-[var(--color-brand-pink)]" : "text-[var(--color-foreground)]/70"}`}
      />
    </button>
  );
}
