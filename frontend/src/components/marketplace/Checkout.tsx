"use client";

import { Loader2, ShieldCheck } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatCedis } from "@/lib/format";
import {
  orderBag,
  priceBag,
  requestBuyerCode,
  verifyBuyerCode,
  type Fulfilment,
} from "@/lib/marketplace-api";
import { ghanaPhoneSchema, toGhanaE164 } from "@/lib/phone";
import type { BagItem, BasketPrice } from "@/lib/types";

/**
 * Paying one seller for one or more things: how it is handed over, a
 * discount code, the total, then Paystack.
 *
 * The total shown is the server's (POST /api/sellers/<id>/price/), asked
 * again whenever the items, the handover or the code change, so delivery and
 * discounts are never worked out in the browser. The phone check is the
 * same session trust as asking a question (AskSeller). No `name` on the
 * fields, for the reason AskSeller gives.
 */
export function Checkout({
  sellerId,
  sellerName,
  items,
  onPaying,
}: {
  sellerId: number;
  sellerName: string;
  items: BagItem[];
  /** Called just before the browser leaves for Paystack. */
  onPaying?: () => void;
}) {
  const t = useTranslations("Marketplace");
  const [step, setStep] = useState<"details" | "code">("details");
  const [phone, setPhone] = useState("");
  const [name, setName] = useState("");
  const [fulfilment, setFulfilment] = useState<Fulfilment>("pickup");
  const [note, setNote] = useState("");
  const [discount, setDiscount] = useState("");
  const [appliedCode, setAppliedCode] = useState("");
  const [code, setCode] = useState("");
  const [price, setPrice] = useState<BasketPrice | null>(null);
  const [priceProblem, setPriceProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const itemsKey = JSON.stringify(items);
  useEffect(() => {
    let active = true;
    const handle = window.setTimeout(() => {
      priceBag(sellerId, { items: JSON.parse(itemsKey), fulfilment, code: appliedCode || undefined })
        .then((priced) => {
          if (!active) return;
          setPrice(priced);
          setPriceProblem(null);
        })
        .catch((reason) => {
          if (!active) return;
          setPriceProblem(reason instanceof Error ? reason.message : t("buyFailed"));
          if (appliedCode) setAppliedCode("");
        });
    }, 250);
    return () => {
      active = false;
      window.clearTimeout(handle);
    };
  }, [sellerId, itemsKey, fulfilment, appliedCode, t]);

  async function pay(e164: string) {
    const { authorization_url } = await orderBag(sellerId, {
      items,
      phone: e164,
      name: name.trim(),
      fulfilment,
      note: note.trim() || undefined,
      code: appliedCode || undefined,
    });
    onPaying?.();
    window.location.assign(authorization_url);
  }

  async function start(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (!name.trim()) throw new Error(t("buyNameNeeded"));
      if (fulfilment === "delivery" && !note.trim()) throw new Error(t("buyAddressNeeded"));
      const e164 = toGhanaE164(ghanaPhoneSchema.parse(phone));
      const asked = await requestBuyerCode(e164);
      if (asked.verified) {
        await pay(e164);
        return;
      }
      setStep("code");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t("buyFailed"));
    }
    setBusy(false);
  }

  async function confirm(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const e164 = toGhanaE164(ghanaPhoneSchema.parse(phone));
      await verifyBuyerCode(e164, code.trim());
      await pay(e164);
      return;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t("codeFailed"));
    }
    setBusy(false);
  }

  const total = price ? formatCedis(price.total) : "…";
  const payLabel = t("payAction", { total });

  return (
    <div className="space-y-3.5">
      {error ? (
        <p role="alert" className="rounded-lg bg-[var(--color-destructive)]/10 px-3 py-2 text-sm text-[var(--color-destructive)]">
          {error}
        </p>
      ) : null}

      {step === "details" ? (
        <form onSubmit={start} className="space-y-3.5">
          <div>
            <Label htmlFor="buy-phone">{t("phoneLabel")}</Label>
            <Input
              id="buy-phone"
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              required
              value={phone}
              onChange={(event) => setPhone(event.target.value)}
              placeholder="024 123 4567"
            />
          </div>
          <div>
            <Label htmlFor="buy-name">{t("buyNameLabel")}</Label>
            <Input
              id="buy-name"
              autoComplete="name"
              required
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </div>
          <fieldset>
            <legend className="text-sm font-medium">{t("handoverLabel")}</legend>
            <div className="mt-1.5 grid grid-cols-2 gap-2">
              {(["pickup", "delivery"] as const).map((choice) => (
                <label
                  key={choice}
                  className="flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border border-[var(--color-border)] px-3 text-sm has-[:checked]:border-[var(--color-brand)] has-[:checked]:bg-[var(--color-brand-soft)]"
                >
                  <input
                    type="radio"
                    checked={fulfilment === choice}
                    onChange={() => setFulfilment(choice)}
                    className="accent-[var(--color-brand)]"
                  />
                  {t(choice)}
                </label>
              ))}
            </div>
          </fieldset>
          <div>
            <Label htmlFor="buy-note">
              {fulfilment === "delivery" ? t("addressLabel") : t("noteLabel")}
            </Label>
            <textarea
              id="buy-note"
              rows={2}
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder={fulfilment === "delivery" ? t("addressPlaceholder") : undefined}
              className="mt-1.5 w-full rounded-lg border border-[var(--color-input)] bg-[var(--color-card)] px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)]"
            />
            {fulfilment === "delivery" ? (
              <p className="mt-1.5 text-xs text-[var(--color-muted-foreground)]">
                {price?.delivery_fee !== null && price?.delivery_fee !== undefined
                  ? t("deliveryFeeHelp", {
                      fee: formatCedis(price.delivery_fee),
                      area: price.delivery_area || t("theirArea"),
                    })
                  : t("deliveryHelp", { seller: sellerName })}
              </p>
            ) : null}
          </div>

          <div className="flex items-end gap-2">
            <div className="min-w-0 flex-1">
              <Label htmlFor="buy-discount">{t("discountLabel")}</Label>
              <Input
                id="buy-discount"
                autoCapitalize="characters"
                value={discount}
                onChange={(event) => setDiscount(event.target.value)}
              />
            </div>
            <Button
              type="button"
              variant="outline"
              disabled={!discount.trim()}
              onClick={() => setAppliedCode(discount.trim())}
            >
              {t("discountApply")}
            </Button>
          </div>

          {/* The server's sum, line by line. */}
          {price ? (
            <dl className="space-y-1 rounded-xl bg-[var(--color-muted)] p-3 text-sm">
              {price.lines.map((line) => (
                <div key={`${line.product}-${line.option}`} className="flex justify-between gap-3">
                  <dt className="min-w-0 truncate">
                    {line.quantity} × {line.product_name}
                    {line.option_label ? ` (${line.option_label})` : ""}
                  </dt>
                  <dd className="tabular-nums">{formatCedis(line.total)}</dd>
                </div>
              ))}
              {Number(price.discount) > 0 ? (
                <div className="flex justify-between gap-3 text-[var(--color-visit)]">
                  <dt>{t("discountLine", { code: price.code })}</dt>
                  <dd className="tabular-nums">−{formatCedis(price.discount)}</dd>
                </div>
              ) : null}
              {Number(price.delivery) > 0 ? (
                <div className="flex justify-between gap-3">
                  <dt>{t("deliveryLine")}</dt>
                  <dd className="tabular-nums">{formatCedis(price.delivery)}</dd>
                </div>
              ) : null}
              <div className="flex justify-between gap-3 border-t border-[var(--color-border)] pt-1 font-bold">
                <dt>{t("totalLine")}</dt>
                <dd className="tabular-nums">{formatCedis(price.total)}</dd>
              </div>
            </dl>
          ) : null}
          {priceProblem ? (
            <p role="alert" className="text-sm text-[var(--color-destructive)]">
              {priceProblem}
            </p>
          ) : null}

          <Button type="submit" variant="brand" className="w-full" disabled={busy || !price}>
            {busy ? <Loader2 aria-hidden="true" className="animate-spin" /> : null}
            {payLabel}
          </Button>
          <p className="text-xs leading-relaxed text-[var(--color-muted-foreground)]">
            {price?.protected ? (
              <span className="inline-flex items-start gap-1.5">
                <ShieldCheck aria-hidden="true" className="mt-0.5 size-3.5 shrink-0 text-[var(--color-visit)]" />
                {t("protectedHelp", { seller: sellerName })}
              </span>
            ) : (
              t("payHelp", { seller: sellerName })
            )}
          </p>
        </form>
      ) : (
        <form onSubmit={confirm} className="space-y-3.5">
          <p className="text-sm text-[var(--color-muted-foreground)]">{t("codeSentTo", { phone })}</p>
          <div>
            <Label htmlFor="buy-code">{t("codeLabel")}</Label>
            <Input
              id="buy-code"
              inputMode="numeric"
              autoComplete="one-time-code"
              required
              value={code}
              onChange={(event) => setCode(event.target.value)}
            />
          </div>
          <Button type="submit" variant="brand" className="w-full" disabled={busy}>
            {busy ? <Loader2 aria-hidden="true" className="animate-spin" /> : null}
            {payLabel}
          </Button>
        </form>
      )}
    </div>
  );
}
