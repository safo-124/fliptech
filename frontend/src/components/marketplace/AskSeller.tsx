"use client";

import { ArrowRight, Check, Loader2, MessageCircle } from "lucide-react";
import { useState } from "react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { askAboutProduct, requestBuyerCode, verifyBuyerCode } from "@/lib/marketplace-api";
import { ghanaPhoneSchema, toGhanaE164 } from "@/lib/phone";

type Step = "ask" | "code" | "done";

/**
 * Asking a seller about a product.
 *
 * Three states and no account. The number is verified once per browser
 * session, and that trust is shared with the training enquiry — somebody who
 * asked about a welding course an hour ago goes straight through here.
 *
 * The code step is skipped entirely when the session already trusts the
 * number: the request endpoint answers `code_sent: false` and says the
 * number is already verified, which is the whole point of the shared trust
 * and the reason this is not a two-screen form for most people.
 */
export function AskSeller({
  productId,
  sellerName,
}: {
  productId: number;
  sellerName: string;
}) {
  const t = useTranslations("Marketplace");
  const [step, setStep] = useState<Step>("ask");
  const [phone, setPhone] = useState("");
  const [name, setName] = useState("");
  const [message, setMessage] = useState("");
  const [code, setCode] = useState("");
  const [reference, setReference] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function fail(reason: unknown, fallback: string) {
    setError(reason instanceof Error ? reason.message : fallback);
    setBusy(false);
  }

  async function send(e164: string) {
    const result = await askAboutProduct(productId, {
      phone: e164,
      name: name.trim() || undefined,
      message: message.trim() || undefined,
    });
    setReference(result.reference_code);
    setStep("done");
  }

  async function start(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const e164 = toGhanaE164(ghanaPhoneSchema.parse(phone));
      const asked = await requestBuyerCode(e164);
      // Already proved in this session: no second code, straight through.
      if (asked.verified) await send(e164);
      else setStep("code");
    } catch (reason) {
      fail(reason, t("askFailed"));
      return;
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
      await send(e164);
    } catch (reason) {
      fail(reason, t("codeFailed"));
      return;
    }
    setBusy(false);
  }

  // Deliberately no `name` on any field.
  //
  // This is a client-side form: React state carries the values and the
  // handler calls preventDefault. But if a click lands before hydration
  // finishes — a real thing on a slow phone — the browser does a native GET
  // submit instead, and a named field goes into the URL. That put a
  // someone's phone number in the address bar, in their history and in
  // every server log on the way. Unnamed controls submit nothing, so the
  // fallback is a harmless reload rather than a leak.
  if (step === "done") {
    return (
      <Card>
        <CardHeader>
          <div className="mb-2 grid size-11 place-items-center rounded-xl bg-[var(--color-visit-bg)] text-[var(--color-visit)]">
            <Check aria-hidden="true" className="size-5" />
          </div>
          <CardTitle>{t("askedTitle")}</CardTitle>
        </CardHeader>
        <CardContent>
          {/* Says a person passes it on, because one does. "We have told
              them" would be a promise about a queue the buyer cannot see. */}
          <p className="text-sm leading-relaxed text-[var(--color-muted-foreground)]">
            {t("askedBody", { seller: sellerName })}
          </p>
          <p className="mt-3 text-sm">
            {t("yourReference")}{" "}
            <strong className="font-mono tracking-wide">{reference}</strong>
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="mb-2 grid size-11 place-items-center rounded-xl bg-[var(--color-brand-soft)] text-[var(--color-brand-strong)]">
          <MessageCircle aria-hidden="true" className="size-5" />
        </div>
        <CardTitle>{step === "ask" ? t("askTitle") : t("codeTitle")}</CardTitle>
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

        {step === "ask" ? (
          <form onSubmit={start} className="space-y-3.5">
            <div>
              <Label htmlFor="ask-phone">{t("phoneLabel")}</Label>
              <Input
                id="ask-phone"
                type="tel"
                inputMode="tel"
                autoComplete="tel"
                required
                value={phone}
                onChange={(event) => setPhone(event.target.value)}
                placeholder="024 123 4567"
              />
              <p className="mt-1.5 text-xs text-[var(--color-muted-foreground)]">
                {t("phoneHelp")}
              </p>
            </div>
            <div>
              <Label htmlFor="ask-name">{t("nameLabel")}</Label>
              <Input
                id="ask-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="ask-message">{t("messageLabel")}</Label>
              <textarea
                id="ask-message"
                rows={3}
                value={message}
                onChange={(event) => setMessage(event.target.value)}
                placeholder={t("messagePlaceholder")}
                className="mt-1.5 w-full rounded-lg border border-[var(--color-input)] bg-[var(--color-card)] px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)]"
              />
            </div>
            <Button type="submit" variant="brand" className="w-full" disabled={busy}>
              {busy ? <Loader2 aria-hidden="true" className="animate-spin" /> : null}
              {t("askAction")}
              {busy ? null : <ArrowRight aria-hidden="true" />}
            </Button>
          </form>
        ) : (
          <form onSubmit={confirm} className="space-y-3.5">
            <p className="text-sm text-[var(--color-muted-foreground)]">
              {t("codeSentTo", { phone })}
            </p>
            <div>
              <Label htmlFor="ask-code">{t("codeLabel")}</Label>
              <Input
                id="ask-code"
                inputMode="numeric"
                autoComplete="one-time-code"
                required
                value={code}
                onChange={(event) => setCode(event.target.value)}
              />
            </div>
            <Button type="submit" variant="brand" className="w-full" disabled={busy}>
              {busy ? <Loader2 aria-hidden="true" className="animate-spin" /> : null}
              {t("codeAction")}
            </Button>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
