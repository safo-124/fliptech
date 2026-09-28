"use client";

import {
  ArrowLeft,
  ArrowRight,
  Loader2,
  LockKeyhole,
  Mail,
  ShieldCheck,
  Smartphone,
  UserRound,
} from "lucide-react";
import {useRouter, useSearchParams} from "next/navigation";
import {useEffect, useState} from "react";

import {Button} from "@/components/ui/button";
import {Card, CardContent, CardDescription, CardFooter, CardHeader} from "@/components/ui/card";
import {Input} from "@/components/ui/input";
import {Label} from "@/components/ui/label";
import {NativeSelect} from "@/components/ui/native-select";
import {ghanaPhoneSchema, toGhanaE164} from "@/lib/phone";
import {
  getTraineeSession,
  requestTraineeCode,
  requestTraineeEmailCode,
  safeNextPath,
  uploadTraineeAvatar,
  verifyTraineeCode,
  verifyTraineeEmailCode,
} from "@/lib/trainee-api";
import type {TraineeSignUpProfile} from "@/lib/trainee-api";

type Step = "phone" | "code";

/** Mirrors TraineeAccount.EducationLevel in backend/trainees/models.py. The
 *  split that matters is SHS general against SHS technical: someone leaving a
 *  technical SHS has already done workshop hours. */
const EDUCATION_LEVELS: Array<[string, string]> = [
  ["not_in_school", "Not in school"],
  ["jhs", "JHS"],
  ["shs_general", "SHS — general"],
  ["shs_technical", "SHS — technical or vocational"],
  ["tvet", "CTVET or other TVET institution"],
  ["university", "University or other tertiary"],
  ["other", "Something else"],
];

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
  const params = useSearchParams();
  const next = safeNextPath(params.get("next"));
  // Which door they came through. There is only one flow — passwordless means
  // signing up and signing in are the same act — but somebody who clicked
  // "Sign up" and landed on a page headed "Continue" reasonably concludes
  // they are in the wrong place. The flow does not change; the framing does.
  const signingUp = params.get("new") === "1";
  const [step, setStep] = useState<Step>("phone");
  const [method, setMethod] = useState<Method>("phone");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  // Everything below is optional and only shown to somebody signing up. It
  // travels with the code, so there is no second screen to abandon.
  const [profile, setProfile] = useState<TraineeSignUpProfile>({});
  const [photo, setPhoto] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [photoError, setPhotoError] = useState<string | null>(null);
  // Shown instead of going straight through, and only when there is something
  // the person would otherwise never learn. A clean join is not interrupted.
  const [outcome, setOutcome] = useState<string | null>(null);

  function field<K extends keyof TraineeSignUpProfile>(key: K, value: TraineeSignUpProfile[K]) {
    setProfile((current) => ({...current, [key]: value}));
  }

  function choosePhoto(file: File | null) {
    setPhotoError(null);
    if (!file) {
      setPhoto(null);
      setPhotoPreview(null);
      return;
    }
    // Checked here as well as on the server, so somebody on a slow connection
    // is told before they spend the upload rather than after.
    if (file.size > 15 * 1024 * 1024) {
      setPhotoError("That picture is larger than 15 MB. Try a smaller one.");
      return;
    }
    setPhoto(file);
    setPhotoPreview(URL.createObjectURL(file));
  }
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
      const challenge = await requestTraineeCode(
        toGhanaE164(parsed.data),
        // So the code arrives by email too, for anyone whose text does not.
        signingUp ? profile.email?.trim() || undefined : undefined,
      );
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
      let held: string | null = null;
      if (method === "email") {
        await verifyTraineeEmailCode(challengeId, email.trim(), code);
      } else {
        const parsed = ghanaPhoneSchema.parse(phone);
        const result = await verifyTraineeCode(
          challengeId,
          toGhanaE164(parsed),
          code,
          signingUp ? profile : undefined,
        );
        // Only the address is worth stopping for. A number that already had an
        // account is not a problem to report — it just signed them in, which
        // is what they wanted.
        if (result.email_outcome === "taken") {
          held =
            "You are signed in, but that email address is already used by another account, so we did not add it. You can add a different one from your account.";
        } else if (result.email_outcome === "already_set") {
          held =
            "You are signed in. This account already has an email address, so we kept the one that was there.";
        }
      }
      // Only now does an account exist to attach it to. A picture that fails
      // to upload must not strand somebody who is already signed in, so it is
      // stepped over — the account screen can take another.
      if (signingUp && photo) {
        await uploadTraineeAvatar(photo).catch(() => undefined);
      }
      if (held) {
        setOutcome(held);
        setBusy(false);
        return;
      }
      router.replace(next);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "That code did not work.");
      setBusy(false);
    }
  }

  if (outcome) {
    return (
      <Card>
        <CardHeader className="sm:px-6 sm:pt-6">
          <div className="mb-2 grid size-11 place-items-center rounded-xl bg-[var(--color-warn-bg)] text-[var(--color-warn)]">
            <Mail aria-hidden="true" className="size-5" />
          </div>
          <h2 className="text-xl font-bold tracking-tight">One thing to know</h2>
          <CardDescription>{outcome}</CardDescription>
        </CardHeader>
        <CardFooter className="sm:px-6">
          <Button
            type="button"
            variant="brand"
            className="w-full"
            onClick={() => router.replace(next)}
          >
            Go to my account
            <ArrowRight aria-hidden="true" />
          </Button>
        </CardFooter>
      </Card>
    );
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
          {method === "email"
            ? "Continue with your email"
            : signingUp
              ? "Create your account"
              : "Continue with your phone"}
        </h2>
        <CardDescription>
          {method === "email"
            ? "For an address you already added to your account. We send a one-time code."
            : signingUp
              ? "This is the whole sign-up: your number, then the code we send you. No password. Add your email below and the code goes there too, in case the text is slow. If you already have an account, this signs you into it."
              : "New or returning, it is the same step. We send a one-time code by text, and to your email as well if you have added one. No password."}
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

          {signingUp && method === "phone" ? (
            <div className="space-y-4 rounded-2xl border border-[var(--color-border)] p-4">
              <div>
                <p className="text-sm font-semibold">A bit about you</p>
                <p className="mt-0.5 text-xs leading-5 text-[var(--color-muted-foreground)]">
                  All optional, and you can change any of it later. Workshops answer better when
                  they know what you have already done.
                </p>
              </div>

              <div className="flex items-center gap-3">
                {photoPreview ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={photoPreview}
                    alt=""
                    className="size-14 shrink-0 rounded-full object-cover"
                  />
                ) : (
                  <span className="grid size-14 shrink-0 place-items-center rounded-full bg-[var(--color-muted)] text-[var(--color-muted-foreground)]">
                    <UserRound aria-hidden="true" className="size-6" />
                  </span>
                )}
                <div className="min-w-0 flex-1">
                  <Label htmlFor="trainee-photo" className="text-sm">
                    Profile picture
                  </Label>
                  <Input
                    id="trainee-photo"
                    type="file"
                    accept="image/*"
                    className="mt-1 text-xs"
                    onChange={(event) => choosePhoto(event.target.files?.[0] ?? null)}
                  />
                  {photoError ? (
                    <p role="alert" className="mt-1 text-xs text-[var(--color-destructive)]">
                      {photoError}
                    </p>
                  ) : (
                    <p className="mt-1 text-xs leading-4 text-[var(--color-muted-foreground)]">
                      Only you and Skills Hub staff see it. It is never shown to a workshop.
                    </p>
                  )}
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="trainee-name">Your name</Label>
                <Input
                  id="trainee-name"
                  value={profile.display_name ?? ""}
                  maxLength={120}
                  onChange={(event) => field("display_name", event.target.value)}
                  placeholder="How workshops should address you"
                  autoComplete="name"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="trainee-signup-email">Email address</Label>
                <Input
                  id="trainee-signup-email"
                  type="email"
                  value={profile.email ?? ""}
                  onChange={(event) => field("email", event.target.value)}
                  placeholder="you@example.com"
                  autoComplete="email"
                />
                <p className="text-xs leading-4 text-[var(--color-muted-foreground)]">
                  We send your code here as well as by text. Confirm it later from your account to
                  use it for signing in.
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="trainee-education">Education so far</Label>
                <NativeSelect
                  id="trainee-education"
                  value={profile.education_level ?? ""}
                  onChange={(event) => field("education_level", event.target.value)}
                >
                  <option value="">Prefer not to say</option>
                  {EDUCATION_LEVELS.map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </NativeSelect>
              </div>

              {profile.education_level && profile.education_level !== "not_in_school" ? (
                <>
                  <div className="space-y-2">
                    <Label htmlFor="trainee-institution">School or institution</Label>
                    <Input
                      id="trainee-institution"
                      value={profile.institution_name ?? ""}
                      maxLength={200}
                      onChange={(event) => field("institution_name", event.target.value)}
                      placeholder="For example: Accra Technical Training Centre"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="trainee-field">What you studied</Label>
                    <Input
                      id="trainee-field"
                      value={profile.field_of_study ?? ""}
                      maxLength={200}
                      onChange={(event) => field("field_of_study", event.target.value)}
                      placeholder="For example: building construction"
                    />
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="space-y-2">
                      <Label htmlFor="trainee-status">How it went</Label>
                      <NativeSelect
                        id="trainee-status"
                        value={profile.education_status ?? ""}
                        onChange={(event) => field("education_status", event.target.value)}
                      >
                        <option value="">Prefer not to say</option>
                        <option value="in_progress">Still studying</option>
                        <option value="completed">Completed</option>
                        <option value="left">Left before finishing</option>
                      </NativeSelect>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="trainee-year">Year</Label>
                      <Input
                        id="trainee-year"
                        inputMode="numeric"
                        value={profile.education_year ?? ""}
                        onChange={(event) => {
                          const digits = event.target.value.replace(/\D/g, "").slice(0, 4);
                          field("education_year", digits ? Number(digits) : null);
                        }}
                        placeholder="2024"
                      />
                    </div>
                  </div>
                </>
              ) : null}
            </div>
          ) : null}

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
              added, so it must not look like the main route.

              Hidden entirely for somebody joining. account_for_verified_email
              never creates an account: email is a second door into one that
              exists. Offering it to a first-time visitor is offering a door
              that cannot open — they would type their address, receive a code,
              and be told to sign in with their phone instead. Their address is
              already on the form above, and the code goes there as well as to
              the phone, which is what they actually wanted from it. */}
          {signingUp ? null : (
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
          )}
        </CardFooter>
      </form>
    </Card>
  );
}
