"use client";

import {CheckCircle2, Eye, EyeOff, Loader2, XCircle} from "lucide-react";
import Link from "next/link";
import {useRouter, useSearchParams} from "next/navigation";
import {useTranslations} from "next-intl";
import {useEffect, useRef, useState} from "react";

import {Button} from "@/components/ui/button";
import {Input} from "@/components/ui/input";
import {Label} from "@/components/ui/label";
import {confirmEmail, getAccount, resetPassword} from "@/lib/account-api";
import {announceSessionChange} from "@/lib/sign-in";

/** /account/reset-password?uid=..&token=..: the link from the email. */
export function ResetPasswordForm() {
  const t = useTranslations("PasswordPages");
  const tSignIn = useTranslations("SignIn");
  const params = useSearchParams();
  const router = useRouter();
  const uid = params.get("uid") ?? "";
  const token = params.get("token") ?? "";
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  // The CSRF cookie the reset needs.
  useEffect(() => {
    void getAccount().catch(() => {});
  }, []);

  if (!uid || !token) {
    return <p role="alert" className="text-sm text-[var(--color-destructive)]">{t("resetBadLink")}</p>;
  }
  if (done) {
    return (
      <div className="space-y-4">
        <p role="status" className="flex items-start gap-2 text-[var(--color-visit)]">
          <CheckCircle2 aria-hidden className="mt-0.5 size-5 shrink-0" />
          {t("resetDone")}
        </p>
        <Button asChild variant="brand" className="min-h-12 w-full">
          <Link href="/account">{t("toAccount")}</Link>
        </Button>
      </div>
    );
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await resetPassword({uid, token, password});
      announceSessionChange();
      setDone(true);
      router.refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : tSignIn("failed"));
    }
    setBusy(false);
  }

  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      <p className="text-sm text-[var(--color-muted-foreground)]">{t("resetLead")}</p>
      {error ? (
        <p role="alert" className="rounded-lg bg-[var(--color-destructive)]/10 px-3 py-2 text-sm text-[var(--color-destructive)]">
          {error}
        </p>
      ) : null}
      <div>
        <Label htmlFor="reset-password">{tSignIn("newPasswordLabel")}</Label>
        <div className="relative">
          <Input
            id="reset-password"
            type={show ? "text" : "password"}
            autoComplete="new-password"
            required
            minLength={8}
            autoFocus
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className="pr-12"
            aria-describedby="reset-password-hint"
          />
          <button
            type="button"
            onClick={() => setShow((on) => !on)}
            aria-label={show ? tSignIn("hidePassword") : tSignIn("showPassword")}
            aria-pressed={show}
            className="absolute inset-y-0 right-0 grid w-11 place-items-center text-[var(--color-muted-foreground)]"
          >
            {show ? <EyeOff aria-hidden className="size-4" /> : <Eye aria-hidden className="size-4" />}
          </button>
        </div>
        <p id="reset-password-hint" className="mt-1.5 text-xs text-[var(--color-muted-foreground)]">
          {tSignIn("passwordHint")}
        </p>
      </div>
      <Button type="submit" variant="brand" className="min-h-12 w-full" disabled={busy || password.length < 8}>
        {busy ? <Loader2 aria-hidden className="animate-spin" /> : null}
        {t("resetSubmit")}
      </Button>
    </form>
  );
}

/** /account/confirm-email?uid=..&token=..: the link from the email. */
export function ConfirmEmail() {
  const t = useTranslations("PasswordPages");
  const params = useSearchParams();
  const uid = params.get("uid") ?? "";
  const token = params.get("token") ?? "";
  const [state, setState] = useState<{done: true; email: string} | {done: false} | null>(null);
  const asked = useRef(false);

  useEffect(() => {
    if (asked.current) return;
    asked.current = true;
    getAccount()
      .catch(() => null)
      .then(() => confirmEmail({uid, token}))
      .then((reply) => setState({done: true, email: reply.email}))
      .catch(() => setState({done: false}));
  }, [uid, token]);

  if (!state) {
    return (
      <p className="flex items-center gap-2 text-sm text-[var(--color-muted-foreground)]">
        <Loader2 aria-hidden className="size-4 animate-spin" />
        {t("confirming")}
      </p>
    );
  }
  return (
    <div className="space-y-4">
      {state.done ? (
        <p role="status" className="flex items-start gap-2 text-[var(--color-visit)]">
          <CheckCircle2 aria-hidden className="mt-0.5 size-5 shrink-0" />
          {t("confirmed", {email: state.email})}
        </p>
      ) : (
        <p role="alert" className="flex items-start gap-2 text-[var(--color-destructive)]">
          <XCircle aria-hidden className="mt-0.5 size-5 shrink-0" />
          {t("confirmFailed")}
        </p>
      )}
      <Button asChild variant="brand" className="min-h-12 w-full">
        <Link href="/account">{t("toAccount")}</Link>
      </Button>
    </div>
  );
}
