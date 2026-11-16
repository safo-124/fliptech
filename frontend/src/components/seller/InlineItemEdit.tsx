"use client";

import {Check, Loader2} from "lucide-react";
import {useTranslations} from "next-intl";
import {useState} from "react";

import {updateProduct, type SellerProduct} from "@/lib/seller-api";
import {cn} from "@/lib/utils";

/**
 * Price, stock and sold out, changed in the list without opening the form:
 * the three things a seller updates most, often with a customer in front of
 * them. Each saves on its own; the list reloads with the result.
 */
export function InlineItemEdit({
  product,
  onChanged,
}: {
  product: SellerProduct;
  onChanged: (message: string) => Promise<void>;
}) {
  const t = useTranslations("QuickAdd");
  const shown = (value: string | null) => (value ? value.replace(/\.00$/, "") : "");
  const [price, setPrice] = useState(shown(product.price));
  const [stock, setStock] = useState(product.stock === null ? "" : String(product.stock));
  const [busy, setBusy] = useState<"price" | "stock" | "sold" | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  const priceChanged = price.trim() !== shown(product.price);
  const stockChanged = stock !== (product.stock === null ? "" : String(product.stock));
  const soldOut = product.availability === "sold_out";

  async function save(which: "price" | "stock" | "sold") {
    setBusy(which);
    setProblem(null);
    try {
      if (which === "price") {
        // As typed: the server reads "1,200"; empty is Ask for price.
        await updateProduct(product.id, {price: price.trim() || null});
        await onChanged(t("priceSaved"));
      } else if (which === "stock") {
        await updateProduct(product.id, {
          stock: stock === "" ? null : Math.max(0, Number.parseInt(stock, 10) || 0),
        });
        await onChanged(t("stockSaved"));
      } else {
        await updateProduct(product.id, {
          availability: soldOut ? "available" : "sold_out",
          ...(soldOut && product.stock === 0 ? {stock: null} : {}),
        });
        await onChanged(soldOut ? t("backOnSale") : t("markedSoldOut"));
      }
    } catch (reason) {
      setProblem(reason instanceof Error ? reason.message : t("failed"));
    }
    setBusy(null);
  }

  const field =
    "min-h-11 w-full rounded-xl border border-[var(--color-border)] bg-[var(--color-card)] px-3 text-sm font-semibold outline-none focus:border-[var(--color-brand)]";
  const saveButton =
    "grid size-11 shrink-0 place-items-center rounded-xl bg-[var(--color-brand)] text-white disabled:opacity-50";

  return (
    <div className="mt-2.5 space-y-2">
      <div className="grid grid-cols-2 gap-2">
        <form
          className="flex items-center gap-1.5"
          onSubmit={(event) => {
            event.preventDefault();
            if (priceChanged) void save("price");
          }}
        >
          <label className="sr-only" htmlFor={`price-${product.id}`}>
            {t("priceFor", {name: product.name})}
          </label>
          <input
            id={`price-${product.id}`}
            inputMode="decimal"
            value={price}
            placeholder={t("askForPrice")}
            onChange={(event) => setPrice(event.target.value)}
            className={field}
          />
          {priceChanged ? (
            <button type="submit" disabled={busy !== null} aria-label={t("savePrice")} className={saveButton}>
              {busy === "price" ? <Loader2 aria-hidden="true" className="size-4 animate-spin" /> : <Check aria-hidden="true" className="size-4" />}
            </button>
          ) : null}
        </form>
        <form
          className="flex items-center gap-1.5"
          onSubmit={(event) => {
            event.preventDefault();
            if (stockChanged) void save("stock");
          }}
        >
          <label className="sr-only" htmlFor={`stock-${product.id}`}>
            {t("stockFor", {name: product.name})}
          </label>
          <input
            id={`stock-${product.id}`}
            inputMode="numeric"
            value={stock}
            placeholder={t("notCounted")}
            onChange={(event) => setStock(event.target.value.replace(/\D/g, ""))}
            className={field}
          />
          {stockChanged ? (
            <button type="submit" disabled={busy !== null} aria-label={t("saveStock")} className={saveButton}>
              {busy === "stock" ? <Loader2 aria-hidden="true" className="size-4 animate-spin" /> : <Check aria-hidden="true" className="size-4" />}
            </button>
          ) : null}
        </form>
      </div>
      <button
        type="button"
        aria-pressed={soldOut}
        disabled={busy !== null}
        onClick={() => void save("sold")}
        className={cn(
          "inline-flex min-h-11 items-center gap-2 rounded-xl border px-3 text-sm font-semibold",
          soldOut
            ? "border-[var(--color-warn)] bg-[var(--color-warn-bg)] text-[var(--color-warn)]"
            : "border-[var(--color-border)] text-[var(--color-muted-foreground)]",
        )}
      >
        {busy === "sold" ? <Loader2 aria-hidden="true" className="size-4 animate-spin" /> : null}
        {soldOut ? t("soldOutTapToReopen") : t("markSoldOut")}
      </button>
      {problem ? (
        <p role="alert" className="text-xs font-medium text-[var(--color-destructive)]">
          {problem}
        </p>
      ) : null}
    </div>
  );
}
