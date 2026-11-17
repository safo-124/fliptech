"use client";

import {CheckCircle2, Eye, EyeOff, KeyRound, Loader2} from "lucide-react";
import {useTranslations} from "next-intl";
import {useState} from "react";

import {Button} from "@/components/ui/button";
import {Card, CardContent, CardHeader, CardTitle} from "@/components/ui/card";
import {Input} from "@/components/ui/input";
import {Label} from "@/components/ui/label";
import {resendConfirmEmail, setAccountPassword, type CustomerAccount} from "@/lib/account-api";

/**
 * The account page's Password and Email: set a password (an account made
 * with a phone code has none), or change it with the current one; whether
 * the email is confirmed, and the link sent again if not.
 */
export function AccountSecurity({account, reload}: {account: CustomerAccount; reload: () => void}) {
  const t = useTranslations("AccountPassword");
  const tSignIn = useTranslations("SignIn");
  const [current, setCurrent] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [state, setState] = useState<{ok: string} | {problem: string} | null>(null);
  const [emailNote, setEmailNote] = useState<string | null>(null);
  const has = Boolean(account.has_password);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setState(null);
    try {
      await setAccountPassword(has ? {current_password: current, password} : {password});
      setCurrent("");
      setPassword("");
      setState({ok: t("saved")});
      reload();
    } catch (reason) {
      setState({problem: reason instanceof Error ? reason.message : tSignIn("failed")});
    }
    setBusy(false);
  }

  const field = (id: string, label: string, value: string, set: (v: string) => void, auto: string) => (
    <div>
      <Label htmlFor={id}>{label}</Label>
      <div className="relative">
        <Input
          id={id}
          type={show ? "text" : "password"}
          autoComplete={auto}
          value={value}
          onChange={(event) => set(event.target.value)}
          className="pr-12"
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
    </div>
  );

  return (
    <Card id="password" className="scroll-mt-24">
      <CardHeader className="flex-row items-center gap-3 space-y-0">
        <KeyRound aria-hidden="true" className="size-5 text-[var(--color-brand)]" />
        <CardTitle>{t("title")}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        <form onSubmit={save} noValidate className="space-y-3">
          <p className="text-sm text-[var(--color-muted-foreground)]">{has ? t("changeLead") : t("setLead")}</p>
          {has ? field("account-current-password", t("current"), current, setCurrent, "current-password") : null}
          {field("account-new-password", t("new"), password, setPassword, "new-password")}
          <p className="text-xs text-[var(--color-muted-foreground)]">{tSignIn("passwordHint")}</p>
          {state && "problem" in state ? (
            <p role="alert" className="rounded-lg bg-[var(--color-destructive)]/10 px-3 py-2 text-sm text-[var(--color-destructive)]">
              {state.problem}
            </p>
          ) : null}
          {state && "ok" in state ? (
            <p role="status" className="flex items-center gap-1.5 text-sm text-[var(--color-visit)]">
              <CheckCircle2 aria-hidden className="size-4" />
              {state.ok}
            </p>
          ) : null}
          <Button type="submit" variant="brand" disabled={busy || password.length < 8 || (has && !current)}>
            {busy ? <Loader2 aria-hidden className="animate-spin" /> : null}
            {t("save")}
          </Button>
        </form>

        <div className="border-t border-[var(--color-border)] pt-4 text-sm">
          <p className="font-semibold">{t("emailTitle")}</p>
          {!account.email ? (
            <p className="mt-1 text-[var(--color-muted-foreground)]">{t("noEmail")}</p>
          ) : account.email_verified ? (
            <p className="mt-1 flex items-center gap-1.5 text-[var(--color-visit)]">
              <CheckCircle2 aria-hidden className="size-4" />
              {account.email} · {t("emailConfirmed")}
            </p>
          ) : (
            <div className="mt-1 space-y-2">
              <p className="text-[var(--color-muted-foreground)]">
                {account.email} · {t("emailNotConfirmed")}
              </p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="min-h-11"
                onClick={async () => {
                  setEmailNote(null);
                  try {
                    setEmailNote((await resendConfirmEmail()).detail);
                  } catch (reason) {
                    setEmailNote(reason instanceof Error ? reason.message : tSignIn("failed"));
                  }
                }}
              >
                {t("resend")}
              </Button>
              {emailNote ? <p role="status" className="text-xs">{emailNote}</p> : null}
            </div>
          )}
          {account.phone_verified === false ? (
            <p className="mt-3 text-xs text-[var(--color-muted-foreground)]">
              {account.phone} · {t("phoneNotChecked")}
            </p>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}
