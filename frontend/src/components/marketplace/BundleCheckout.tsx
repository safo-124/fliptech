"use client";

import { Loader2, ShieldCheck } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getAccount } from "@/lib/account-api";
import { formatCedis } from "@/lib/format";
import { orderBundle, requestBuyerCode, verifyBuyerCode, type Fulfilment } from "@/lib/marketplace-api";
import { ghanaPhoneSchema, toGhanaE164 } from "@/lib/phone";
import type { Bundle } from "@/lib/types";

/**
 * Paying for a bundle: who, how it is handed over, then Paystack. The price
 * is the server's (the bundle's own); delivery is added when chosen. The
 * phone check is the same as for any order, and the course opens on that
 * phone when the payment arrives.
 */
export function BundleCheckout({ bundle }: { bundle: Bundle }) {
  const t = useTranslations("Marketplace");
  const [step, setStep] = useState<"details" | "code">("details");
  const [phone, setPhone] = useState("");
  const [name, setName] = useState("");
  const [fulfilment, setFulfilment] = useState<Fulfilment>("pickup");
  const [note, setNote] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    getAccount()
      .then((session) => {
        if (!active || !session.authenticated) return;
        setPhone((typed) => typed || session.account.phone);
        setName((typed) => typed || session.account.display_name);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  const delivery = fulfilment === "delivery" && bundle.delivery_fee ? Number(bundle.delivery_fee) : 0;
  const total = formatCedis(String(Number(bundle.price ?? 0) + delivery));

  async function pay(e164: string) {
    const { authorization_url } = await orderBundle(bundle.id, {
      phone: e164,
      name: name.trim(),
      fulfilment,
      note: note.trim() || undefined,
    });
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

  return (
    <div className="space-y-3.5">
      {error ? (
        <p role="alert" className="rounded-lg bg-[var(--color-destructive)]/10 px-3 py-2 text-sm text-[var(--color-destructive)]">
          {error}
        </p>
      ) : null}
      {step === "details" ? (
        <form onSubmit={(event) => void start(event)} className="space-y-3.5">
          <div>
            <Label htmlFor="bundle-phone">{t("phoneLabel")}</Label>
            <Input
              id="bundle-phone"
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              required
              value={phone}
              onChange={(event) => setPhone(event.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="bundle-name">{t("bundleNameLabel")}</Label>
            <Input id="bundle-name" autoComplete="name" required value={name} onChange={(event) => setName(event.target.value)} />
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
                    disabled={choice === "delivery" && bundle.delivery_fee === null}
                    onChange={() => setFulfilment(choice)}
                    className="accent-[var(--color-brand)]"
                  />
                  {t(choice)}
                </label>
              ))}
            </div>
          </fieldset>
          <div>
            <Label htmlFor="bundle-note">{fulfilment === "delivery" ? t("addressLabel") : t("noteLabel")}</Label>
            <textarea
              id="bundle-note"
              rows={2}
              value={note}
              onChange={(event) => setNote(event.target.value)}
              className="mt-1.5 w-full rounded-lg border border-[var(--color-input)] bg-[var(--color-card)] px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)]"
            />
          </div>
          <p className="flex items-start gap-2 rounded-xl bg-[var(--color-visit-bg)] p-3 text-sm text-[var(--color-visit)]">
            <ShieldCheck aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
            {t("bundleCourseUnlocks")}
          </p>
          <Button type="submit" variant="brand" className="w-full" disabled={busy || !bundle.buy_online}>
            {busy ? <Loader2 aria-hidden="true" className="animate-spin" /> : null}
            {bundle.buy_online ? t("bundlePay", { amount: total }) : t("bundleUnavailable")}
          </Button>
        </form>
      ) : (
        <form onSubmit={(event) => void confirm(event)} className="space-y-3.5">
          <div>
            <Label htmlFor="bundle-code">{t("codeLabel")}</Label>
            <Input
              id="bundle-code"
              inputMode="numeric"
              autoComplete="one-time-code"
              required
              value={code}
              onChange={(event) => setCode(event.target.value)}
            />
          </div>
          <Button type="submit" variant="brand" className="w-full" disabled={busy}>
            {busy ? <Loader2 aria-hidden="true" className="animate-spin" /> : null}
            {t("bundlePay", { amount: total })}
          </Button>
        </form>
      )}
    </div>
  );
}
