"use client";

import {ArrowRight, Eye, EyeOff, Loader2, MailCheck} from "lucide-react";
import {useTranslations} from "next-intl";
import {useState} from "react";
import {ZodError} from "zod";

import {Button} from "@/components/ui/button";
import {Input} from "@/components/ui/input";
import {Label} from "@/components/ui/label";
import {
  forgotPassword,
  registerWithPassword,
  signInWithPassword,
  type AccountSession,
} from "@/lib/account-api";
import {ghanaPhoneSchema, toGhanaE164} from "@/lib/phone";

export type PasswordMode = "sign_in" | "register" | "forgot";

/**
 * Signing in with a phone number or email and a password, creating an
 * account (phone, password, and an email if they want one), or asking for a link to set a new
 * password (backend accounts/passwords.py). The way in while SMS codes cannot
 * be relied on; PhoneSignIn shows it, and the code only when it is switched on.
 *
 * `onSignedIn` gets the session and whether the account is new.
 */
export function PasswordSignIn({
  idPrefix,
  initialMode,
  onSignedIn,
  onUseCode,
  onModeChange,
}: {
  idPrefix: string;
  initialMode: PasswordMode;
  onSignedIn: (session: AccountSession, joined: boolean) => void | Promise<void>;
  /** Offered only when the phone code is switched on. */
  onUseCode?: () => void;
  /** Told whenever the form switches between sign in, create and forgot,
      so the page's heading can say the same. */
  onModeChange?: (mode: PasswordMode) => void;
}) {
  const t = useTranslations("SignIn");
  const [mode, setMode] = useState<PasswordMode>(initialMode);
  const [login, setLogin] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<string | null>(null);

  function problem(reason: unknown) {
    if (reason instanceof ZodError) return t("phoneInvalid");
    return reason instanceof Error ? reason.message : t("failed");
  }

  // The page asked for the other form (Register or Sign in in the header).
  const [asked, setAsked] = useState(initialMode);
  if (asked !== initialMode) {
    setAsked(initialMode);
    setMode(initialMode);
  }

  function go(next: PasswordMode) {
    setMode(next);
    onModeChange?.(next);
    setError(null);
    setSent(null);
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (mode === "sign_in") {
        if (!login.trim()) throw new Error(t("loginNeeded"));
        const session = await signInWithPassword(login.trim(), password);
        await onSignedIn(session, false);
      } else if (mode === "register") {
        const e164 = toGhanaE164(ghanaPhoneSchema.parse(phone));
        // Optional while phone codes are off; checked only when given.
        const typedEmail = email.trim();
        if (typedEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(typedEmail)) throw new Error(t("emailInvalid"));
        if (password !== confirm) throw new Error(t("passwordsDiffer"));
        const session = await registerWithPassword({phone: e164, password, ...(typedEmail ? {email: typedEmail} : {})});
        await onSignedIn(session, true);
      } else {
        if (!login.trim()) throw new Error(t("loginNeeded"));
        const reply = await forgotPassword(login.trim());
        setSent(reply.detail);
      }
    } catch (reason) {
      setError(problem(reason));
    }
    setBusy(false);
  }

  const passwordField = (
    id: string,
    label: string,
    autoComplete: string,
    hint?: string,
    value = password,
    onChange: (next: string) => void = setPassword,
    invalid = false,
  ) => (
    <div>
      <Label htmlFor={id}>{label}</Label>
      <div className="relative">
        <Input
          id={id}
          type={show ? "text" : "password"}
          autoComplete={autoComplete}
          required
          minLength={mode === "register" ? 8 : undefined}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className="pr-12"
          aria-invalid={invalid || undefined}
          aria-describedby={hint ? `${id}-hint` : undefined}
        />
        <button
          type="button"
          onClick={() => setShow((on) => !on)}
          aria-label={show ? t("hidePassword") : t("showPassword")}
          aria-pressed={show}
          className="absolute inset-y-0 right-0 grid w-11 place-items-center text-[var(--color-muted-foreground)]"
        >
          {show ? <EyeOff aria-hidden className="size-4" /> : <Eye aria-hidden className="size-4" />}
        </button>
      </div>
      {hint ? (
        <p
          id={`${id}-hint`}
          className={`mt-1.5 text-xs ${invalid ? "font-medium text-[var(--color-destructive)]" : "text-[var(--color-muted-foreground)]"}`}
        >
          {hint}
        </p>
      ) : null}
    </div>
  );

  const alert = error ? (
    <p role="alert" className="rounded-lg bg-[var(--color-destructive)]/10 px-3 py-2 text-sm text-[var(--color-destructive)]">
      {error}
    </p>
  ) : null;

  const link = "inline-flex min-h-11 items-center text-sm font-semibold text-[var(--color-brand)] hover:underline";

  if (mode === "forgot") {
    return (
      <form onSubmit={submit} className="space-y-4" noValidate>
        <div>
          <p className="text-base font-bold">{t("forgotTitle")}</p>
          <p className="mt-1 text-sm text-[var(--color-muted-foreground)]">{t("forgotLead")}</p>
        </div>
        {alert}
        {sent ? (
          <p role="status" className="flex items-start gap-2 rounded-lg bg-[var(--color-visit-bg)] px-3 py-2.5 text-sm text-[var(--color-visit)]">
            <MailCheck aria-hidden className="mt-0.5 size-4 shrink-0" />
            {sent}
          </p>
        ) : null}
        <div>
          <Label htmlFor={`${idPrefix}-forgot`}>{t("loginLabel")}</Label>
          <Input
            id={`${idPrefix}-forgot`}
            autoComplete="username"
            required
            autoFocus
            value={login}
            onChange={(event) => setLogin(event.target.value)}
            placeholder={t("loginPlaceholder")}
          />
        </div>
        <Button type="submit" variant="brand" className="w-full" disabled={busy}>
          {busy ? <Loader2 aria-hidden className="animate-spin" /> : null}
          {t("forgotSubmit")}
        </Button>
        <p className="text-xs text-[var(--color-muted-foreground)]">{t("forgotNoEmail")}</p>
        <button type="button" className={link} onClick={() => go("sign_in")}>
          {t("backToSignIn")}
        </button>
      </form>
    );
  }

  if (mode === "register") {
    return (
      <form onSubmit={submit} className="space-y-4" noValidate>
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
        <div>
          <Label htmlFor={`${idPrefix}-email`}>{t("emailLabel")}</Label>
          <Input
            id={`${idPrefix}-email`}
            type="email"
            inputMode="email"
            autoComplete="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="you@example.com"
            aria-describedby={`${idPrefix}-email-hint`}
          />
          <p id={`${idPrefix}-email-hint`} className="mt-1.5 text-xs text-[var(--color-muted-foreground)]">
            {t("emailHint")}
          </p>
        </div>
        {passwordField(`${idPrefix}-new-password`, t("newPasswordLabel"), "new-password", t("passwordHint"))}
        {passwordField(
          `${idPrefix}-confirm-password`,
          t("confirmPasswordLabel"),
          "new-password",
          confirm && confirm !== password ? t("passwordsDiffer") : undefined,
          confirm,
          setConfirm,
          Boolean(confirm) && confirm !== password,
        )}
        <Button type="submit" variant="brand" className="w-full" disabled={busy}>
          {busy ? <Loader2 aria-hidden className="animate-spin" /> : null}
          {t("registerSubmit")}
          {busy ? null : <ArrowRight aria-hidden />}
        </Button>
        <p className="text-sm">
          {t("haveAccount")}{" "}
          <button type="button" className={link} onClick={() => go("sign_in")}>
            {t("toSignIn")}
          </button>
        </p>
        {onUseCode ? (
          <button type="button" className={link} onClick={onUseCode}>
            {t("useCode")}
          </button>
        ) : null}
      </form>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      {alert}
      <div>
        <Label htmlFor={`${idPrefix}-login`}>{t("loginLabel")}</Label>
        <Input
          id={`${idPrefix}-login`}
          autoComplete="username"
          required
          autoFocus
          value={login}
          onChange={(event) => setLogin(event.target.value)}
          placeholder={t("loginPlaceholder")}
        />
      </div>
      {passwordField(`${idPrefix}-password`, t("passwordLabel"), "current-password")}
      <Button type="submit" variant="brand" className="w-full" disabled={busy}>
        {busy ? <Loader2 aria-hidden className="animate-spin" /> : null}
        {t("signInSubmit")}
        {busy ? null : <ArrowRight aria-hidden />}
      </Button>
      <div className="flex flex-col items-start">
        <button type="button" className={link} onClick={() => go("forgot")}>
          {t("forgotLink")}
        </button>
        <button type="button" className={link} onClick={() => go("forgot")}>
          {t("codeUserLink")}
        </button>
      </div>
      <p className="text-sm">
        {t("noAccount")}{" "}
        <button type="button" className={link} onClick={() => go("register")}>
          {t("toRegister")}
        </button>
      </p>
      {onUseCode ? (
        <button type="button" className={link} onClick={onUseCode}>
          {t("useCode")}
        </button>
      ) : null}
    </form>
  );
}
