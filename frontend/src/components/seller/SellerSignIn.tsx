"use client";

import {ArrowRight, Loader2, Store} from "lucide-react";
import {useRouter} from "next/navigation";
import {useEffect, useState} from "react";
import {useTranslations} from "next-intl";

import {Button} from "@/components/ui/button";
import {Card, CardContent, CardDescription, CardFooter, CardHeader} from "@/components/ui/card";
import {Input} from "@/components/ui/input";
import {Label} from "@/components/ui/label";
import {ghanaPhoneSchema, toGhanaE164} from "@/lib/phone";
import {getSellerSession, requestSellerCode, verifySellerCode} from "@/lib/seller-api";

/**
 * Signing in to sell, which is also signing up.
 *
 * One number, one code, no password — the same bargain the rest of the site
 * makes. Nothing else is asked here: the shop's name and where it is are
 * filled in afterwards from the dashboard, because a form standing between
 * somebody and an account is a form some of them do not finish.
 *
 * Fields carry no `name`. The handler calls preventDefault, but a tap that
 * lands before hydration does a native GET submit instead and every named
 * field goes into the address bar, the history and the server log. Unnamed
 * controls submit nothing, so the fallback is a harmless reload.
 */
export function SellerSignIn() {
  const t = useTranslations("SellerPages");
  const router = useRouter();
  const [step, setStep] = useState<"phone" | "code">("phone");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [challengeId, setChallengeId] = useState("");
  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Already signed in: go straight through rather than asking somebody to
  // prove a number they proved an hour ago.
  useEffect(() => {
    let active = true;
    getSellerSession()
      .then((session) => {
        if (active && session.authenticated) router.replace("/sell/shop");
        else if (active) setChecking(false);
      })
      .catch(() => active && setChecking(false));
    return () => {
      active = false;
    };
  }, [router]);

  async function askForCode(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const e164 = toGhanaE164(ghanaPhoneSchema.parse(phone));
      const {challenge_id} = await requestSellerCode(e164);
      setChallengeId(challenge_id);
      setStep("code");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t("codeRequestFailed"));
    }
    setBusy(false);
  }

  async function confirm(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const e164 = toGhanaE164(ghanaPhoneSchema.parse(phone));
      await verifySellerCode(challengeId, e164, code.trim());
      router.replace("/sell/shop");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t("codeWrong"));
      setBusy(false);
    }
  }

  if (checking) {
    return (
      <Card>
        <CardContent className="grid place-items-center py-12">
          <Loader2 aria-hidden="true" className="size-5 animate-spin text-[var(--color-muted-foreground)]" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="sm:px-6 sm:pt-6">
        <div className="mb-2 grid size-11 place-items-center rounded-xl bg-[var(--color-brand-soft)] text-[var(--color-brand-strong)]">
          <Store aria-hidden="true" className="size-5" />
        </div>
        <h2 className="text-xl font-bold tracking-tight">
          {step === "phone" ? t("signInHeading") : t("codeHeading")}
        </h2>
        <CardDescription>
          {step === "phone" ? t("signInLead") : t("codeSentTo", {phone})}
        </CardDescription>
      </CardHeader>

      <CardContent className="sm:px-6">
        {error ? (
          <p
            role="alert"
            className="mb-4 rounded-lg bg-[var(--color-destructive)]/10 px-3 py-2 text-sm text-[var(--color-destructive)]"
          >
            {error}
          </p>
        ) : null}

        {step === "phone" ? (
          <form onSubmit={askForCode} id="seller-sign-in">
            <Label htmlFor="seller-phone">{t("phoneLabel")}</Label>
            <Input
              id="seller-phone"
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              required
              autoFocus
              value={phone}
              onChange={(event) => setPhone(event.target.value)}
              placeholder="024 123 4567"
            />
            <p className="mt-2 text-xs leading-relaxed text-[var(--color-muted-foreground)]">
              {t("phoneHelp")}
            </p>
          </form>
        ) : (
          <form onSubmit={confirm} id="seller-sign-in">
            <Label htmlFor="seller-code">{t("codeLabel")}</Label>
            <Input
              id="seller-code"
              inputMode="numeric"
              autoComplete="one-time-code"
              required
              autoFocus
              value={code}
              onChange={(event) => setCode(event.target.value)}
            />
            <button
              type="button"
              onClick={() => {
                setStep("phone");
                setCode("");
                setError(null);
              }}
              className="mt-3 text-xs font-semibold text-[var(--color-brand-strong)] hover:underline"
            >
              {t("wrongNumber")}
            </button>
          </form>
        )}
      </CardContent>

      <CardFooter className="sm:px-6">
        <Button type="submit" form="seller-sign-in" variant="brand" className="w-full" disabled={busy}>
          {busy ? <Loader2 aria-hidden="true" className="animate-spin" /> : null}
          {step === "phone" ? t("sendCode") : t("confirmCode")}
          {busy ? null : <ArrowRight aria-hidden="true" />}
        </Button>
      </CardFooter>
    </Card>
  );
}
