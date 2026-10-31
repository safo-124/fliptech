"use client";

import { Loader2, ShoppingBag } from "lucide-react";
import { useState } from "react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatCedis } from "@/lib/format";
import { orderProduct, requestBuyerCode, verifyBuyerCode } from "@/lib/marketplace-api";
import { ghanaPhoneSchema, toGhanaE164 } from "@/lib/phone";

type Step = "details" | "code";

/**
 * Paying for a product on the site.
 *
 * The same phone check as asking a question (AskSeller), and the same
 * session trust: somebody who asked about this bag an hour ago pays with no
 * second code. Then Paystack's own page takes the money, mobile money or
 * card, and sends them back to /marketplace/order/<reference>.
 *
 * No `name` on the fields, for the reason AskSeller gives: a tap before
 * hydration would otherwise put a phone number in the address bar.
 */
export function BuyNow({
  productId,
  price,
  sellerName,
}: {
  productId: number;
  price: string;
  sellerName: string;
}) {
  const t = useTranslations("Marketplace");
  const [step, setStep] = useState<Step>("details");
  const [phone, setPhone] = useState("");
  const [name, setName] = useState("");
  const [quantity, setQuantity] = useState(1);
  const [fulfilment, setFulfilment] = useState<"pickup" | "delivery">("pickup");
  const [note, setNote] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const total = (Number(price) * quantity).toFixed(2);

  async function pay(e164: string) {
    const { authorization_url } = await orderProduct(productId, {
      phone: e164,
      name: name.trim(),
      quantity,
      fulfilment,
      note: note.trim() || undefined,
    });
    window.location.href = authorization_url;
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

  return (
    <Card className="border-[var(--color-brand)]/30">
      <CardHeader>
        <div className="mb-2 grid size-11 place-items-center rounded-xl bg-[var(--color-brand)] text-white">
          <ShoppingBag aria-hidden="true" className="size-5" />
        </div>
        <CardTitle>{step === "details" ? t("buyTitle") : t("codeTitle")}</CardTitle>
      </CardHeader>
      <CardContent>
        {error ? (
          <p
            role="alert"
            className="mb-4 rounded-lg bg-[var(--color-destructive)]/10 px-3 py-2 text-sm text-[var(--color-destructive)]"
          >
            {error}
          </p>
        ) : null}

        {step === "details" ? (
          <form onSubmit={start} className="space-y-3.5">
            <div className="grid grid-cols-[1fr_6rem] gap-3">
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
                <Label htmlFor="buy-quantity">{t("quantityLabel")}</Label>
                <Input
                  id="buy-quantity"
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={20}
                  value={quantity}
                  onChange={(event) =>
                    setQuantity(Math.min(20, Math.max(1, Number(event.target.value) || 1)))
                  }
                />
              </div>
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
                    {t(choice === "pickup" ? "pickup" : "delivery")}
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
                  {t("deliveryHelp", { seller: sellerName })}
                </p>
              ) : null}
            </div>
            <Button type="submit" variant="brand" className="w-full" disabled={busy}>
              {busy ? <Loader2 aria-hidden="true" className="animate-spin" /> : null}
              {t("payAction", { total: formatCedis(total) })}
            </Button>
            <p className="text-xs leading-relaxed text-[var(--color-muted-foreground)]">
              {t("payHelp", { seller: sellerName })}
            </p>
          </form>
        ) : (
          <form onSubmit={confirm} className="space-y-3.5">
            <p className="text-sm text-[var(--color-muted-foreground)]">
              {t("codeSentTo", { phone })}
            </p>
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
              {t("payAction", { total: formatCedis(total) })}
            </Button>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
