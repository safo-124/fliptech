"use client";

import {ArrowLeft, ArrowRight, Loader2, LockKeyhole, Mail, ShieldCheck, Smartphone} from "lucide-react";
import {useRouter, useSearchParams} from "next/navigation";
import {useEffect, useState} from "react";

import {Button} from "@/components/ui/button";
import {Card, CardContent, CardDescription, CardFooter, CardHeader} from "@/components/ui/card";
import {Input} from "@/components/ui/input";
import {Label} from "@/components/ui/label";
import {ghanaPhoneSchema, toGhanaE164} from "@/lib/phone";
import {
  getTraineeSession,
  requestTraineeCode,
  requestTraineeEmailCode,
  safeNextPath,
  verifyTraineeCode,
  verifyTraineeEmailCode,
} from "@/lib/trainee-api";

type Step = "phone" | "code";

/**
 * Which identifier is being used.
 *
 * Phone is the default and stays the default. It is the identity the account
 * is built on — a workshop replies to it on WhatsApp — and email only works
 * for someone who already added one. Leading with email would send first-time
 * trainees down a route that cannot work for them.
 */
type Method = "phone" | "email";

/**
 * Sign up and sign in are the same thing for a trainee: prove the phone number
 * and the account exists. There is no separate registration form to abandon.
 */
export function TraineeSignIn() {
  const router = useRouter();
  const next = safeNextPath(useSearchParams().get("next"));
  const [step, setStep] = useState<Step>("phone");
  const [method, setMethod] = useState<Method>("phone");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [challengeId, setChallengeId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Already signed in: go straight on.
  useEffect(() => {
    let active = true;
    getTraineeSession()
      .then((session) => {
        if (active && session.authenticated) router.replace(next);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [next, router]);

  async function sendCode(event: React.FormEvent) {
    event.preventDefault();

    if (method === "email") {
      const address = email.trim();
      // Deliberately shallow: the server validates properly, and a regex that
      // second-guesses what a valid address looks like rejects real ones.
      if (!address.includes("@")) {
        setError("Enter your email address.");
        return;
      }
      setBusy(true);
      setError(null);
      try {
        const challenge = await requestTraineeEmailCode(address);
        setChallengeId(challenge.challenge_id);
        setCode("");
        setStep("code");
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : "Could not send a code.");
      } finally {
        setBusy(false);
      }
      return;
    }

    const parsed = ghanaPhoneSchema.safeParse(phone);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Enter a Ghana mobile number.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const challenge = await requestTraineeCode(toGhanaE164(parsed.data));
      setChallengeId(challenge.challenge_id);
      setCode("");
      setStep("code");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not send a code.");
    } finally {
      setBusy(false);
    }
  }

  async function checkCode(event: React.FormEvent) {
    event.preventDefault();
    if (!challengeId || code.length < 4) {
      setError("Enter the code from your message.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      if (method === "email") {
        await verifyTraineeEmailCode(challengeId, email.trim(), code);
      } else {
        const parsed = ghanaPhoneSchema.parse(phone);
        await verifyTraineeCode(challengeId, toGhanaE164(parsed), code);
      }
      router.replace(next);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "That code did not work.");
      setBusy(false);
    }
  }

  if (step === "code") {
    return (
      <Card className="overflow-hidden">
        <CardHeader className="pb-4 text-center sm:px-6 sm:pt-6">
          <div className="mx-auto mb-2 grid size-11 place-items-center rounded-xl bg-[var(--color-brand-soft)] text-[var(--color-brand-strong)]">
            <ShieldCheck aria-hidden="true" className="size-5" />
          </div>
          <h2 className="text-xl font-bold tracking-tight">
            {method === "email" ? "Check your email" : "Check your messages"}
          </h2>
          <CardDescription>
            We sent a code to {method === "email" ? email.trim() : phone}.
          </CardDescription>
        </CardHeader>
        <form onSubmit={checkCode} noValidate aria-busy={busy}>
          <CardContent className="space-y-3 sm:px-6">
            <Label htmlFor="trainee-code">Verification code</Label>
            <Input
              id="trainee-code"
              name="verification-code"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]*"
              maxLength={8}
              value={code}
              onChange={(event) => setCode(event.target.value.replace(/\D/g, ""))}
              aria-invalid={Boolean(error)}
              aria-describedby={error ? "trainee-code-error" : undefined}
              className="text-center text-xl font-semibold tabular-nums tracking-[0.3em]"
              autoFocus
            />
            {error ? (
              <p id="trainee-code-error" role="alert" className="text-sm text-[var(--color-destructive)]">
                {error}
              </p>
            ) : null}
          </CardContent>
          <CardFooter className="flex-col gap-2 sm:px-6">
            <Button type="submit" variant="brand" disabled={busy} className="w-full">
              {busy ? <Loader2 aria-hidden="true" className="animate-spin" /> : <ShieldCheck aria-hidden="true" />}
              {busy ? "Checking…" : "Verify and continue"}
            </Button>
            <Button
              type="button"
              variant="ghost"
              className="w-full"
              onClick={() => {
                setStep("phone");
                setError(null);
              }}
            >
              <ArrowLeft aria-hidden="true" />
              {method === "email" ? "Change email address" : "Change phone number"}
            </Button>
          </CardFooter>
        </form>
      </Card>
    );
  }

  return (
    <Card className="overflow-hidden">
      <CardHeader className="pb-4 sm:px-6 sm:pt-6">
        <div className="mb-2 grid size-11 place-items-center rounded-xl bg-[var(--color-brand-soft)] text-[var(--color-brand-strong)]">
          {method === "email" ? (
            <Mail aria-hidden="true" className="size-5" />
          ) : (
            <Smartphone aria-hidden="true" className="size-5" />
          )}
        </div>
        <h2 className="text-xl font-bold tracking-tight">
          {method === "email" ? "Continue with your email" : "Continue with your phone"}
        </h2>
        <CardDescription>
          {method === "email"
            ? "For an address you already added to your account. We send a one-time code."
            : "New or returning, it is the same step. We send a one-time code. No password."}
        </CardDescription>
      </CardHeader>
      <form onSubmit={sendCode} noValidate aria-busy={busy}>
        <CardContent className="space-y-3 sm:px-6">
          {method === "email" ? (
            <>
              <Label htmlFor="trainee-email">Email address</Label>
              <Input
                id="trainee-email"
                name="email"
                type="email"
                inputMode="email"
                autoComplete="email"
                placeholder="you@example.com"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                aria-invalid={Boolean(error)}
                aria-describedby={error ? "trainee-email-error" : "trainee-email-help"}
              />
              {error ? (
                <p
                  id="trainee-email-error"
                  role="alert"
                  className="text-sm text-[var(--color-destructive)]"
                >
                  {error}
                </p>
              ) : (
                <p
                  id="trainee-email-help"
                  className="text-xs leading-5 text-[var(--color-muted-foreground)]"
                >
                  This works only if you already added this address to your account. If you
                  have not, use your phone number.
                </p>
              )}
            </>
          ) : (
            <>
              <Label htmlFor="trainee-phone">Mobile number</Label>
              <Input
                id="trainee-phone"
                name="phone"
                type="tel"
                inputMode="tel"
                autoComplete="tel"
                placeholder="024 123 4567"
                value={phone}
                onChange={(event) => setPhone(event.target.value)}
                aria-invalid={Boolean(error)}
                aria-describedby={error ? "trainee-phone-error" : "trainee-phone-help"}
              />
              {error ? (
                <p
                  id="trainee-phone-error"
                  role="alert"
                  className="text-sm text-[var(--color-destructive)]"
                >
                  {error}
                </p>
              ) : (
                <p
                  id="trainee-phone-help"
                  className="text-xs leading-5 text-[var(--color-muted-foreground)]"
                >
                  Use the number you enquire with, so your enquiries show up in your account.
                </p>
              )}
            </>
          )}
          <div className="flex items-start gap-2.5 rounded-xl bg-[var(--color-muted)]/65 p-3 text-xs leading-5 text-[var(--color-muted-foreground)]">
            <LockKeyhole aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-[var(--color-brand-strong)]" />
            <p>
              {method === "email"
                ? "We keep your email, your phone number and your enquiries. Nothing else is required."
                : "We keep your phone number and your enquiries. Nothing else is required."}
            </p>
          </div>
        </CardContent>
        <CardFooter className="flex-col gap-2 sm:px-6">
          <Button type="submit" variant="brand" disabled={busy} className="w-full">
            {busy ? <Loader2 aria-hidden="true" className="animate-spin" /> : null}
            {busy ? "Sending code…" : "Send my code"}
            {!busy ? <ArrowRight aria-hidden="true" /> : null}
          </Button>
          {/* Phone stays first and stays the default. Email is offered as the
              way out for someone whose SMS is not arriving, which on a prepaid
              network is common — but it only works once an address has been
              added, so it must not look like the main route. */}
          <Button
            type="button"
            variant="ghost"
            className="w-full"
            onClick={() => {
              setMethod(method === "email" ? "phone" : "email");
              setError(null);
            }}
          >
            {method === "email" ? (
              <>
                <Smartphone aria-hidden="true" />
                Use my phone number instead
              </>
            ) : (
              <>
                <Mail aria-hidden="true" />
                Use my email instead
              </>
            )}
          </Button>
        </CardFooter>
      </form>
    </Card>
  );
}
