"use client";

import { Hammer, TriangleAlert } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useState } from "react";
import { useTranslations } from "next-intl";

import { Stepper } from "@/components/basket/Stepper";
import { removeLine, setLineQuantity, type BasketLine } from "@/lib/basket";
import { formatCedis } from "@/lib/format";
import { cn } from "@/lib/utils";

/** One line of the basket, on the basket page and at checkout: photo, name,
    price, − / + (1 up to what is left), Remove, and what the server says
    about it (no longer available, price changed, made to order). */
export function BasketLineRow({ line }: { line: BasketLine }) {
  const t = useTranslations("Basket");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  async function run(change: () => Promise<unknown>) {
    setBusy(true);
    setProblem(null);
    try {
      await change();
    } catch (reason) {
      setProblem(reason instanceof Error ? reason.message : t("loadFailed"));
    }
    setBusy(false);
  }

  return (
    <li className={cn("flex gap-3 py-3", !line.available && "opacity-70")}>
      <Link
        href={`/marketplace/${line.product}`}
        className="relative size-20 shrink-0 overflow-hidden rounded-xl bg-[var(--color-muted)]"
      >
        {line.photo ? <Image src={line.photo} alt="" fill sizes="80px" className="object-cover" /> : null}
      </Link>
      <div className="min-w-0 flex-1">
        <Link href={`/marketplace/${line.product}`} className="line-clamp-2 text-sm font-bold hover:underline">
          {line.name}
          {line.option_label ? <span className="font-normal"> ({line.option_label})</span> : null}
        </Link>
        {line.available ? (
          <p className="mt-0.5 text-sm">
            {line.unit_price ? t("eachPrice", { price: formatCedis(line.unit_price) }) : null}
            {line.line_total && line.quantity > 1 ? (
              <span className="font-semibold"> · {formatCedis(line.line_total)}</span>
            ) : null}
          </p>
        ) : (
          <p className="mt-0.5 text-sm font-semibold text-[var(--color-destructive)]">{t("unavailable")}</p>
        )}
        {line.price_changed ? (
          <p className="mt-1 flex items-start gap-1 text-xs font-semibold text-[var(--color-warn)]">
            <TriangleAlert aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
            {t("priceChanged", {
              from: formatCedis(line.price_changed.from),
              to: formatCedis(line.price_changed.to),
            })}
          </p>
        ) : null}
        {line.available && line.few_left ? (
          <p className="text-xs font-semibold text-[var(--color-warn)]">{t("onlyLeft", { count: line.few_left })}</p>
        ) : null}
        {line.made_to_order ? (
          <p className="mt-1 flex items-start gap-1 text-xs text-[var(--color-muted-foreground)]">
            <Hammer aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
            <span>
              {line.made_to_order.days ? t("aboutDays", { days: line.made_to_order.days }) : t("madeToOrder")}
              {line.made_to_order.deposit ? ` · ${t("depositNow", { amount: formatCedis(line.made_to_order.deposit) })}` : ""}
            </span>
          </p>
        ) : null}
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {line.available ? (
            <Stepper
              value={line.quantity}
              max={line.max_quantity}
              disabled={busy}
              label={t("quantity")}
              onChange={(next) => void run(() => setLineQuantity(line.id, next))}
            />
          ) : null}
          <button
            type="button"
            disabled={busy}
            onClick={() => void run(() => removeLine(line.id))}
            className="min-h-11 px-2 text-sm font-semibold text-[var(--color-muted-foreground)] underline-offset-2 hover:text-[var(--color-destructive)] hover:underline"
          >
            {t("remove")}
          </button>
        </div>
        {problem ? (
          <p role="alert" className="mt-1 text-xs text-[var(--color-destructive)]">
            {problem}
          </p>
        ) : null}
      </div>
    </li>
  );
}
