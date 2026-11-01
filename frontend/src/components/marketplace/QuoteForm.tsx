"use client";

import { Check, Loader2 } from "lucide-react";
import { useState } from "react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { requestBuyerCode, requestQuote, verifyBuyerCode, type QuoteInput } from "@/lib/marketplace-api";
import { ghanaPhoneSchema, toGhanaE164 } from "@/lib/phone";

type Option = { slug: string; name: string };

/**
 * Describe a job once, and makers in that trade are told. They see the job
 * but not the buyer's number until they choose to take it up; the buyer is
 * texted each time one does. Same phone check as asking a question.
 */
export function QuoteForm({ trades, areas }: { trades: Option[]; areas: Option[] }) {
  const t = useTranslations("Marketplace");
  const [form, setForm] = useState({
    trade: "",
    area: "",
    title: "",
    details: "",
    quantity: "",
    budget: "",
    needed_by: "",
    name: "",
    phone: "",
  });
  const [step, setStep] = useState<"form" | "code" | "done">("form");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ reference: string; makers: number } | null>(null);

  const set = (key: keyof typeof form) => (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    setForm({ ...form, [key]: event.target.value });

  async function send(e164: string) {
    const body: QuoteInput = {
      trade: form.trade,
      area: form.area || undefined,
      title: form.title.trim(),
      details: form.details.trim(),
      quantity: form.quantity.trim() || undefined,
      budget: form.budget.trim() || undefined,
      needed_by: form.needed_by || null,
      name: form.name.trim(),
      phone: e164,
    };
    setResult(await requestQuote(body));
    setStep("done");
  }

  async function start(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (!form.trade || !form.title.trim() || !form.details.trim() || !form.name.trim()) {
        throw new Error(t("quoteMissing"));
      }
      const e164 = toGhanaE164(ghanaPhoneSchema.parse(form.phone));
      const asked = await requestBuyerCode(e164);
      if (asked.verified) await send(e164);
      else setStep("code");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t("quoteFailed"));
    }
    setBusy(false);
  }

  async function confirm(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const e164 = toGhanaE164(ghanaPhoneSchema.parse(form.phone));
      await verifyBuyerCode(e164, code.trim());
      await send(e164);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t("codeFailed"));
    }
    setBusy(false);
  }

  if (step === "done" && result) {
    return (
      <Card className="p-8 text-center">
        <span className="mx-auto grid size-11 place-items-center rounded-xl bg-[var(--color-visit-bg)] text-[var(--color-visit)]">
          <Check aria-hidden="true" className="size-5" />
        </span>
        <p className="mt-3 font-semibold">{t("quoteSentTitle")}</p>
        <p className="mt-1.5 text-sm text-[var(--color-muted-foreground)]">
          {result.makers ? t("quoteSentBody", { count: result.makers }) : t("quoteSentNoMakers")}
        </p>
        <p className="mt-3 text-sm">
          {t("yourReference")} <strong className="font-mono">{result.reference}</strong>
        </p>
      </Card>
    );
  }

  const field = "mt-1.5 w-full rounded-lg border border-[var(--color-input)] bg-[var(--color-card)] px-3 text-sm";
  return (
    <Card>
      <CardContent className="pt-5">
        {error ? (
          <p role="alert" className="mb-4 rounded-lg bg-[var(--color-destructive)]/10 px-3 py-2 text-sm text-[var(--color-destructive)]">
            {error}
          </p>
        ) : null}
        {step === "form" ? (
          <form onSubmit={start} className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <Label htmlFor="quote-trade">{t("quoteTradeLabel")}</Label>
                <select id="quote-trade" required value={form.trade} onChange={set("trade")} className={`${field} h-11`}>
                  <option value="">{t("choose")}</option>
                  {trades.map((trade) => (
                    <option key={trade.slug} value={trade.slug}>
                      {trade.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <Label htmlFor="quote-area">{t("quoteAreaLabel")}</Label>
                <select id="quote-area" value={form.area} onChange={set("area")} className={`${field} h-11`}>
                  <option value="">{t("anyArea")}</option>
                  {areas.map((area) => (
                    <option key={area.slug} value={area.slug}>
                      {area.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div>
              <Label htmlFor="quote-title">{t("quoteWhatLabel")}</Label>
              <Input id="quote-title" required value={form.title} onChange={set("title")} placeholder={t("quoteWhatPlaceholder")} />
            </div>
            <div>
              <Label htmlFor="quote-details">{t("quoteDetailsLabel")}</Label>
              <textarea
                id="quote-details"
                required
                rows={4}
                value={form.details}
                onChange={set("details")}
                placeholder={t("quoteDetailsPlaceholder")}
                className={`${field} py-2`}
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-3">
              <div>
                <Label htmlFor="quote-quantity">{t("quoteQuantityLabel")}</Label>
                <Input id="quote-quantity" value={form.quantity} onChange={set("quantity")} placeholder="60" />
              </div>
              <div>
                <Label htmlFor="quote-budget">{t("quoteBudgetLabel")}</Label>
                <Input id="quote-budget" value={form.budget} onChange={set("budget")} placeholder="GH₵3,000" />
              </div>
              <div>
                <Label htmlFor="quote-date">{t("quoteNeededByLabel")}</Label>
                <Input id="quote-date" type="date" value={form.needed_by} onChange={set("needed_by")} />
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <Label htmlFor="quote-name">{t("buyNameLabel")}</Label>
                <Input id="quote-name" required autoComplete="name" value={form.name} onChange={set("name")} />
              </div>
              <div>
                <Label htmlFor="quote-phone">{t("phoneLabel")}</Label>
                <Input
                  id="quote-phone"
                  type="tel"
                  inputMode="tel"
                  autoComplete="tel"
                  required
                  value={form.phone}
                  onChange={set("phone")}
                  placeholder="024 123 4567"
                />
              </div>
            </div>
            <p className="text-xs text-[var(--color-muted-foreground)]">{t("quotePrivacy")}</p>
            <Button type="submit" variant="brand" className="w-full sm:w-auto" disabled={busy}>
              {busy ? <Loader2 aria-hidden="true" className="animate-spin" /> : null}
              {t("quoteSend")}
            </Button>
          </form>
        ) : (
          <form onSubmit={confirm} className="space-y-3.5">
            <p className="text-sm text-[var(--color-muted-foreground)]">{t("codeSentTo", { phone: form.phone })}</p>
            <div>
              <Label htmlFor="quote-code">{t("codeLabel")}</Label>
              <Input
                id="quote-code"
                inputMode="numeric"
                autoComplete="one-time-code"
                required
                value={code}
                onChange={(event) => setCode(event.target.value)}
              />
            </div>
            <Button type="submit" variant="brand" disabled={busy}>
              {busy ? <Loader2 aria-hidden="true" className="animate-spin" /> : null}
              {t("quoteSend")}
            </Button>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
