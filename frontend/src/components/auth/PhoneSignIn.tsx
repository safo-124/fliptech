"use client";

import {ArrowRight, Check, GraduationCap, Loader2, ShoppingBag, Store} from "lucide-react";
import {useTranslations} from "next-intl";
import {useState} from "react";
import {ZodError} from "zod";

import {Button} from "@/components/ui/button";
import {Input} from "@/components/ui/input";
import {Label} from "@/components/ui/label";
import {
  addRole,
  requestAccountCode,
  updateAccount,
  verifyAccountCode,
  type AccountSession,
} from "@/lib/account-api";
import {syncBagWithAccount, syncSavedWithAccount} from "@/lib/bag";
import {ghanaPhoneSchema, toGhanaE164} from "@/lib/phone";
import {announceSessionChange} from "@/lib/sign-in";

export type Interest = "learn" | "buy" | "sell";

const INTERESTS: {key: Interest; icon: typeof GraduationCap}[] = [
  {key: "learn", icon: GraduationCap},
  {key: "buy", icon: ShoppingBag},
  {key: "sell", icon: Store},
];

/**
 * Signing in with a phone, the same everywhere: the number, the code, and
 * for someone new one more screen, their name and what brought them.
 *
 * `onDone` gets the session once they are in. `role: "trainee"` makes the
 * login a trainee too (for learning), and `interest` ticks that card in
 * advance on the welcome screen.
 */
export function PhoneSignIn({
  role,
  interest,
  idPrefix = "sign-in",
  onDone,
}: {
  role?: "trainee";
  interest?: Interest;
  idPrefix?: string;
  onDone: (session: AccountSession, joined: boolean) => void | Promise<void>;
}) {
  const t = useTranslations("SignIn");
  const [step, setStep] = useState<"phone" | "code" | "welcome">("phone");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [challenge, setChallenge] = useState("");
  const [chosen, setChosen] = useState<Interest[]>(
    interest ? [interest] : role === "trainee" ? ["learn"] : [],
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function problem(reason: unknown) {
    if (reason instanceof ZodError) return t("phoneInvalid");
    return reason instanceof Error ? reason.message : t("failed");
  }

  async function finish(session: AccountSession, joined: boolean) {
    void syncSavedWithAccount();
    void syncBagWithAccount();
    let current = session;
    if (role === "trainee" && current.authenticated && !current.roles.trainee) {
      try {
        current = await addRole("trainee");
      } catch {
        // A trainee login staff switched off stays off; the page says so.
      }
    }
    announceSessionChange();
    await onDone(current, joined);
  }

  async function send(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const sent = await requestAccountCode(toGhanaE164(ghanaPhoneSchema.parse(phone)));
      setChallenge(sent.challenge_id);
      setStep("code");
    } catch (reason) {
      setError(problem(reason));
    }
    setBusy(false);
  }

  async function confirm(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const result = await verifyAccountCode({
        challenge_id: challenge,
        phone: toGhanaE164(ghanaPhoneSchema.parse(phone)),
        code: code.trim(),
      });
      if (result.joined || (result.authenticated && !result.account.display_name)) {
        setName(result.authenticated ? result.account.display_name : "");
        setStep("welcome");
        setBusy(false);
        return;
      }
      await finish(result, false);
    } catch (reason) {
      setError(problem(reason));
    }
    setBusy(false);
  }

  async function welcome(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const session = await updateAccount({
        ...(name.trim() ? {display_name: name.trim()} : {}),
        interests: chosen,
      });
      await finish(session, true);
    } catch (reason) {
      setError(problem(reason));
    }
    setBusy(false);
  }

  const alert = error ? (
    <p
      role="alert"
      className="rounded-lg bg-[var(--color-destructive)]/10 px-3 py-2 text-sm text-[var(--color-destructive)]"
    >
      {error}
    </p>
  ) : null;

  if (step === "welcome") {
    return (
      <form onSubmit={welcome} className="space-y-5">
        {alert}
        <div>
          <p className="text-lg font-bold tracking-[-0.02em]">{t("welcomeTitle")}</p>
          <p className="mt-1 text-sm text-[var(--color-muted-foreground)]">{t("welcomeLead")}</p>
        </div>
        <div>
          <Label htmlFor={`${idPrefix}-name`}>{t("nameLabel")}</Label>
          <Input
            id={`${idPrefix}-name`}
            autoComplete="given-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder={t("namePlaceholder")}
          />
        </div>
        <fieldset>
          <legend className="text-sm font-semibold">{t("interestsTitle")}</legend>
          <p className="text-xs text-[var(--color-muted-foreground)]">{t("interestsHint")}</p>
          <div className="mt-3 grid gap-2">
            {INTERESTS.map(({key, icon: Icon}) => {
              const on = chosen.includes(key);
              return (
                <button
                  key={key}
                  type="button"
                  role="checkbox"
                  aria-checked={on}
                  onClick={() =>
                    setChosen((current) =>
                      on ? current.filter((item) => item !== key) : [...current, key],
                    )
                  }
                  className={`flex min-h-16 items-center gap-3 rounded-2xl border-2 px-3 text-left transition-colors ${
                    on
                      ? "border-[var(--color-brand)] bg-[var(--color-brand-soft)]"
                      : "border-[var(--color-border)] bg-[var(--color-card)] hover:border-[var(--color-brand)]/40"
                  }`}
                >
                  <span
                    className={`grid size-10 shrink-0 place-items-center rounded-xl ${
                      on ? "bg-[var(--color-brand)] text-white" : "bg-[var(--color-muted)] text-[var(--color-brand)]"
                    }`}
                  >
                    <Icon aria-hidden className="size-5" />
                  </span>
                  <span className="flex-1">
                    <b className="block text-sm">{t(`interest.${key}.title`)}</b>
                    <small className="block text-xs text-[var(--color-muted-foreground)]">
                      {t(`interest.${key}.hint`)}
                    </small>
                  </span>
                  <span
                    aria-hidden
                    className={`grid size-6 place-items-center rounded-full border ${
                      on
                        ? "border-[var(--color-brand)] bg-[var(--color-brand)] text-white"
                        : "border-[var(--color-border)]"
                    }`}
                  >
                    {on ? <Check className="size-4" /> : null}
                  </span>
                </button>
              );
            })}
          </div>
        </fieldset>
        <Button type="submit" variant="brand" className="w-full" disabled={busy}>
          {busy ? <Loader2 aria-hidden className="animate-spin" /> : null}
          {t("continue")}
          {busy ? null : <ArrowRight aria-hidden />}
        </Button>
      </form>
    );
  }

  // No `name` attributes, so a tap before hydration cannot put a phone number
  // in the address bar.
  return step === "phone" ? (
    <form onSubmit={send} className="space-y-4">
      {alert}
      <div>
        <Label htmlFor={`${idPrefix}-phone`}>{t("phoneLabel")}</Label>
        <Input
          id={`${idPrefix}-phone`}
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          required
          autoFocus
          value={phone}
          onChange={(event) => setPhone(event.target.value)}
          placeholder="024 123 4567"
        />
      </div>
      <Button type="submit" variant="brand" className="w-full" disabled={busy}>
        {busy ? <Loader2 aria-hidden className="animate-spin" /> : null}
        {t("sendCode")}
        {busy ? null : <ArrowRight aria-hidden />}
      </Button>
      <p className="text-xs leading-5 text-[var(--color-muted-foreground)]">{t("oneAccount")}</p>
    </form>
  ) : (
    <form onSubmit={confirm} className="space-y-4">
      {alert}
      <p className="text-sm text-[var(--color-muted-foreground)]">{t("codeSentTo", {phone})}</p>
      <div>
        <Label htmlFor={`${idPrefix}-code`}>{t("codeLabel")}</Label>
        <Input
          id={`${idPrefix}-code`}
          inputMode="numeric"
          autoComplete="one-time-code"
          required
          autoFocus
          value={code}
          onChange={(event) => setCode(event.target.value)}
        />
      </div>
      <Button type="submit" variant="brand" className="w-full" disabled={busy}>
        {busy ? <Loader2 aria-hidden className="animate-spin" /> : null}
        {t("signIn")}
      </Button>
      <Button type="button" variant="ghost" className="w-full" onClick={() => setStep("phone")}>
        {t("changeNumber")}
      </Button>
    </form>
  );
}
