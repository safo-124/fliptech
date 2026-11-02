"use client";

import { Bell, Check, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getAccount } from "@/lib/account-api";
import { requestBuyerCode, verifyBuyerCode, waitForStock } from "@/lib/marketplace-api";
import { ghanaPhoneSchema, toGhanaE164 } from "@/lib/phone";

/**
 * "Tell me when it's back" on a sold-out product: one text when the seller
 * makes it available again. The number is proved first (or is the signed-in
 * account's), so nobody can sign a stranger up for texts.
 */
export function StockAlert({ productId }: { productId: number }) {
  const t = useTranslations("Marketplace");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [step, setStep] = useState<"phone" | "code" | "done">("phone");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    getAccount()
      .then((session) => {
        if (active && session.authenticated) setPhone((typed) => typed || session.account.phone);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  async function finish(e164: string) {
    await waitForStock(productId, e164);
    setStep("done");
  }

  async function start(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const e164 = toGhanaE164(ghanaPhoneSchema.parse(phone));
      const asked = await requestBuyerCode(e164);
      if (asked.verified) await finish(e164);
      else setStep("code");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t("askFailed"));
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
      await finish(e164);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t("codeFailed"));
    }
    setBusy(false);
  }

  return (
    <Card>
      <CardContent className="pt-5">
        <p className="flex items-center gap-2 text-sm font-semibold">
          <Bell aria-hidden="true" className="size-4 text-[var(--color-brand)]" />
          {t("soldOutTitle")}
        </p>
        <p className="mt-1.5 text-sm leading-relaxed text-[var(--color-muted-foreground)]">{t("stockAlertLead")}</p>
        {error ? (
          <p role="alert" className="mt-3 text-sm text-[var(--color-destructive)]">
            {error}
          </p>
        ) : null}
        {step === "done" ? (
          <p role="status" className="mt-3 flex items-center gap-2 text-sm text-[var(--color-visit)]">
            <Check aria-hidden="true" className="size-4" />
            {t("stockAlertDone")}
          </p>
        ) : step === "phone" ? (
          <form onSubmit={start} className="mt-3 flex flex-wrap items-end gap-2">
            <div className="min-w-0 flex-1">
              <Label htmlFor="stock-phone">{t("phoneLabel")}</Label>
              <Input
                id="stock-phone"
                type="tel"
                inputMode="tel"
                autoComplete="tel"
                required
                value={phone}
                onChange={(event) => setPhone(event.target.value)}
                placeholder="024 123 4567"
              />
            </div>
            <Button type="submit" variant="brand" disabled={busy}>
              {busy ? <Loader2 aria-hidden="true" className="animate-spin" /> : null}
              {t("stockAlertAction")}
            </Button>
          </form>
        ) : (
          <form onSubmit={confirm} className="mt-3 flex flex-wrap items-end gap-2">
            <div className="min-w-0 flex-1">
              <Label htmlFor="stock-code">{t("codeLabel")}</Label>
              <Input
                id="stock-code"
                inputMode="numeric"
                autoComplete="one-time-code"
                required
                value={code}
                onChange={(event) => setCode(event.target.value)}
              />
            </div>
            <Button type="submit" variant="brand" disabled={busy}>
              {t("stockAlertAction")}
            </Button>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
