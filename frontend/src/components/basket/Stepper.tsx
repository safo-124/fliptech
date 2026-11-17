"use client";

import { Minus, Plus } from "lucide-react";
import { useTranslations } from "next-intl";

/** − n +, at least 1 and at most `max`; each button 44px. */
export function Stepper({
  value,
  max,
  onChange,
  disabled = false,
  label,
}: {
  value: number;
  max: number;
  onChange: (next: number) => void;
  disabled?: boolean;
  label: string;
}) {
  const t = useTranslations("Basket");
  return (
    <div
      role="group"
      aria-label={label}
      className="inline-flex items-center rounded-full border border-[var(--color-border)] bg-[var(--color-card)]"
    >
      <button
        type="button"
        aria-label={t("fewer")}
        disabled={disabled || value <= 1}
        onClick={() => onChange(value - 1)}
        className="grid size-11 place-items-center rounded-full disabled:opacity-35"
      >
        <Minus aria-hidden="true" className="size-4" />
      </button>
      <output aria-live="polite" className="min-w-7 text-center text-base font-bold tabular-nums">
        {value}
      </output>
      <button
        type="button"
        aria-label={t("more")}
        disabled={disabled || value >= max}
        onClick={() => onChange(value + 1)}
        className="grid size-11 place-items-center rounded-full disabled:opacity-35"
      >
        <Plus aria-hidden="true" className="size-4" />
      </button>
    </div>
  );
}
