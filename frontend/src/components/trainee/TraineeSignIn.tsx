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
import {useTranslations} from "next-intl";
import {useEffect, useState} from "react";

import {Button} from "@/components/ui/button";
import {Card, CardContent, CardDescription, CardFooter, CardHeader} from "@/components/ui/card";
import {Input} from "@/components/ui/input";
import {Label} from "@/components/ui/label";
import {NativeSelect} from "@/components/ui/native-select";
import {validationMessage} from "@/i18n/validation";
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
 *  technical SHS has already done workshop hours. Labels are in the
 *  "Education" messages. */
export const EDUCATION_LEVELS = [
  "not_in_school",
  "jhs",
  "shs_general",
  "shs_technical",
  "tvet",
  "university",
  "other",
] as const;

export const EDUCATION_STATUSES = ["in_progress", "completed", "left"] as const;

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
  const t = useTranslations("TraineeSignIn");
  const tEducation = useTranslations("Education");
  const tValidation = useTranslations("Validation");
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
      setPhotoError(t("photoTooLarge"));
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
        setError(t("enterEmail"));
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
        setError(reason instanceof Error ? reason.message : t("sendFailed"));
      } finally {
        setBusy(false);
      }
      return;
    }

    const parsed = ghanaPhoneSchema.safeParse(phone);
    if (!parsed.success) {
      setError(
        validationMessage(tValidation, parsed.error.issues[0]?.message) ?? t("enterGhanaNumber"),
      );
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
      setError(reason instanceof Error ? reason.message : t("sendFailed"));
    } finally {
      setBusy(false);
    }
  }

  async function checkCode(event: React.FormEvent) {
    event.preventDefault();
    if (!challengeId || code.length < 4) {
      setError(t("enterCode"));
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
          held = t("emailTaken");
        } else if (result.email_outcome === "already_set") {
          held = t("emailAlreadySet");
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
      setError(reason instanceof Error ? reason.message : t("codeFailed"));
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
          <h2 className="text-xl font-bold tracking-tight">{t("oneThingTitle")}</h2>
          <CardDescription>{outcome}</CardDescription>
        </CardHeader>
        <CardFooter className="sm:px-6">
          <Button
            type="button"
            variant="brand"
            className="w-full"
            onClick={() => router.replace(next)}
          >
            {t("goToAccount")}
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
            {method === "email" ? t("checkEmail") : t("checkMessages")}
          </h2>
          <CardDescription>
            {t("codeSentTo", {destination: method === "email" ? email.trim() : phone})}
          </CardDescription>
        </CardHeader>
        <form onSubmit={checkCode} noValidate aria-busy={busy}>
          <CardContent className="space-y-3 sm:px-6">
            <Label htmlFor="trainee-code">{t("codeLabel")}</Label>
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
              {busy ? t("checking") : t("verify")}
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
              {method === "email" ? t("changeEmail") : t("changePhone")}
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
            ? t("titleEmail")
            : signingUp
              ? t("titleSignUp")
              : t("titlePhone")}
        </h2>
        <CardDescription>
          {method === "email"
            ? t("leadEmail")
            : signingUp
              ? t("leadSignUp")
              : t("leadPhone")}
        </CardDescription>
      </CardHeader>
      <form onSubmit={sendCode} noValidate aria-busy={busy}>
        <CardContent className="space-y-3 sm:px-6">
          {method === "email" ? (
            <>
              <Label htmlFor="trainee-email">{t("emailLabel")}</Label>
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
                  {t("emailHelp")}
                </p>
              )}
            </>
          ) : (
            <>
              <Label htmlFor="trainee-phone">{t("phoneLabel")}</Label>
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
                  {t("phoneHelp")}
                </p>
              )}
            </>
          )}

          {signingUp && method === "phone" ? (
            <div className="space-y-4 rounded-2xl border border-[var(--color-border)] p-4">
              <div>
                <p className="text-sm font-semibold">{t("aboutYouTitle")}</p>
                <p className="mt-0.5 text-xs leading-5 text-[var(--color-muted-foreground)]">
                  {t("aboutYouBody")}
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
                    {t("photoLabel")}
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
                      {t("photoHelp")}
                    </p>
                  )}
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="trainee-name">{t("nameLabel")}</Label>
                <Input
                  id="trainee-name"
                  value={profile.display_name ?? ""}
                  maxLength={120}
                  onChange={(event) => field("display_name", event.target.value)}
                  placeholder={t("namePlaceholder")}
                  autoComplete="name"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="trainee-signup-email">{t("emailLabel")}</Label>
                <Input
                  id="trainee-signup-email"
                  type="email"
                  value={profile.email ?? ""}
                  onChange={(event) => field("email", event.target.value)}
                  placeholder="you@example.com"
                  autoComplete="email"
                />
                <p className="text-xs leading-4 text-[var(--color-muted-foreground)]">
                  {t("signUpEmailHelp")}
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="trainee-education">{t("educationLabel")}</Label>
                <NativeSelect
                  id="trainee-education"
                  value={profile.education_level ?? ""}
                  onChange={(event) => field("education_level", event.target.value)}
                >
                  <option value="">{tEducation("preferNotToSay")}</option>
                  {EDUCATION_LEVELS.map((value) => (
                    <option key={value} value={value}>
                      {tEducation(`levels.${value}`)}
                    </option>
                  ))}
                </NativeSelect>
              </div>

              {profile.education_level && profile.education_level !== "not_in_school" ? (
                <>
                  <div className="space-y-2">
                    <Label htmlFor="trainee-institution">{t("institutionLabel")}</Label>
                    <Input
                      id="trainee-institution"
                      value={profile.institution_name ?? ""}
                      maxLength={200}
                      onChange={(event) => field("institution_name", event.target.value)}
                      placeholder={t("institutionPlaceholder")}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="trainee-field">{t("fieldLabel")}</Label>
                    <Input
                      id="trainee-field"
                      value={profile.field_of_study ?? ""}
                      maxLength={200}
                      onChange={(event) => field("field_of_study", event.target.value)}
                      placeholder={t("fieldPlaceholder")}
                    />
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="space-y-2">
                      <Label htmlFor="trainee-status">{t("statusLabel")}</Label>
                      <NativeSelect
                        id="trainee-status"
                        value={profile.education_status ?? ""}
                        onChange={(event) => field("education_status", event.target.value)}
                      >
                        <option value="">{tEducation("preferNotToSay")}</option>
                        {EDUCATION_STATUSES.map((value) => (
                          <option key={value} value={value}>
                            {tEducation(`statuses.${value}`)}
                          </option>
                        ))}
                      </NativeSelect>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="trainee-year">{t("yearLabel")}</Label>
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
              {method === "email" ? t("keepEmail") : t("keepPhone")}
            </p>
          </div>
        </CardContent>
        <CardFooter className="flex-col gap-2 sm:px-6">
          <Button type="submit" variant="brand" disabled={busy} className="w-full">
            {busy ? <Loader2 aria-hidden="true" className="animate-spin" /> : null}
            {busy ? t("sendingCode") : t("sendCode")}
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
                {t("usePhone")}
              </>
            ) : (
              <>
                <Mail aria-hidden="true" />
                {t("useEmail")}
              </>
            )}
          </Button>
          )}
        </CardFooter>
      </form>
    </Card>
  );
}
