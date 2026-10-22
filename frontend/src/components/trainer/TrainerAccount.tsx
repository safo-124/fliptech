"use client";

import {CheckCircle2, Clock3, Loader2, Mail, MailCheck, Phone, ShieldX} from "lucide-react";
import {useTranslations} from "next-intl";
import {useState} from "react";

import {Badge} from "@/components/ui/badge";
import {Button} from "@/components/ui/button";
import {Card, CardContent, CardDescription, CardHeader, CardTitle} from "@/components/ui/card";
import {Input} from "@/components/ui/input";
import {Label} from "@/components/ui/label";
import {BRAND} from "@/lib/brand";
import {confirmTrainerAddEmail, requestTrainerAddEmailCode} from "@/lib/trainer-api";
import type {TrainerSession} from "@/lib/types";

type SignedIn = Extract<TrainerSession, {authenticated: true}>;

/** How each sign-up state is drawn. Its words are in "TrainerAccount.approval". */
const APPROVAL = {
  confirmed: {variant: "default", Icon: CheckCircle2},
  pending: {variant: "warning", Icon: Clock3},
  declined: {variant: "warning", Icon: ShieldX},
} as const;

type ApprovalState = keyof typeof APPROVAL;

/**
 * How a trainer signs in, and where their sign-up stands.
 *
 * The add-an-email endpoints have existed since email sign-in was built, and
 * nothing in the trainer interface ever called them — so a trainer whose SMS
 * does not arrive had no second door, while a trainee with the same problem
 * had one. This is that screen.
 *
 * Claiming an address takes two steps on purpose: type it, then prove it with
 * a code sent to it. An address the server simply took on trust would let
 * anyone bind sign-in for this account to a mailbox they own.
 */
export function TrainerAccount({
  session,
  onSession,
}: {
  session: SignedIn;
  onSession: (next: SignedIn) => void;
}) {
  const t = useTranslations("TrainerAccount");
  const [draft, setDraft] = useState("");
  const [code, setCode] = useState("");
  const [challenge, setChallenge] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const state: ApprovalState =
    session.account_status && session.account_status in APPROVAL
      ? (session.account_status as ApprovalState)
      : "confirmed";
  const approval = APPROVAL[state];
  const ApprovalIcon = approval.Icon;

  async function sendCode(event: React.FormEvent) {
    event.preventDefault();
    const address = draft.trim();
    if (!address.includes("@")) {
      setError(t("enterEmail"));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const next = await requestTrainerAddEmailCode(address);
      setChallenge(next.challenge_id);
      setCode("");
      setNotice(t("codeSentTo", {email: address}));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t("codeSendFailed"));
    } finally {
      setBusy(false);
    }
  }

  async function confirm(event: React.FormEvent) {
    event.preventDefault();
    if (!challenge) return;
    setBusy(true);
    setError(null);
    try {
      const next = await confirmTrainerAddEmail(challenge, draft.trim(), code);
      if (next.authenticated) onSession(next);
      setChallenge(null);
      setDraft("");
      setCode("");
      setNotice(t("emailAdded"));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t("codeFailed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>{t("signInTitle")}</CardTitle>
          <CardDescription>{t("signInBody")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="flex items-start gap-3 rounded-xl border border-[var(--color-border)] p-3">
            <Phone aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-[var(--color-muted-foreground)]" />
            <div className="min-w-0">
              <p className="text-sm font-semibold">{session.phone}</p>
              <p className="mt-0.5 text-xs leading-5 text-[var(--color-muted-foreground)]">
                {t("phoneNote")}
              </p>
            </div>
          </div>

          {session.email ? (
            <div className="flex items-start gap-3 rounded-xl border border-[var(--color-visit)]/25 bg-[var(--color-visit-bg)] p-3">
              <MailCheck aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-[var(--color-visit)]" />
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold">{session.email}</p>
                <p className="mt-0.5 text-xs leading-5 text-[var(--color-muted-foreground)]">
                  {t("emailVerified")}
                </p>
              </div>
            </div>
          ) : challenge ? (
            <form onSubmit={confirm} className="space-y-3">
              <div className="space-y-2">
                <Label htmlFor="trainer-email-code">{t("enterCodeFor", {email: draft.trim()})}</Label>
                <Input
                  id="trainer-email-code"
                  value={code}
                  onChange={(event) => setCode(event.target.value)}
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  placeholder={t("codePlaceholder")}
                  disabled={busy}
                />
              </div>
              <div className="flex flex-col gap-2 sm:flex-row">
                <Button type="submit" variant="brand" disabled={busy}>
                  {busy ? <Loader2 aria-hidden="true" className="animate-spin" /> : null}
                  {t("addAddress")}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  disabled={busy}
                  onClick={() => {
                    setChallenge(null);
                    setCode("");
                    setNotice(null);
                  }}
                >
                  {t("differentAddress")}
                </Button>
              </div>
            </form>
          ) : (
            <form onSubmit={sendCode} className="space-y-3">
              <div className="space-y-2">
                <Label htmlFor="trainer-email">{t("addEmailLabel")}</Label>
                <Input
                  id="trainer-email"
                  type="email"
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  placeholder="you@example.com"
                  autoComplete="email"
                  disabled={busy}
                />
                <p className="text-xs leading-5 text-[var(--color-muted-foreground)]">
                  {t("addEmailHelp")}
                </p>
              </div>
              <Button type="submit" variant="outline" disabled={busy}>
                {busy ? (
                  <Loader2 aria-hidden="true" className="animate-spin" />
                ) : (
                  <Mail aria-hidden="true" />
                )}
                {t("sendCode")}
              </Button>
            </form>
          )}

          {error ? (
            <p role="alert" className="rounded-xl bg-[var(--color-warn-bg)] p-3 text-sm text-[var(--color-warn)]">
              {error}
            </p>
          ) : null}
          {notice && !error ? (
            <p role="status" className="rounded-xl bg-[var(--color-visit-bg)] p-3 text-sm text-[var(--color-visit)]">
              {notice}
            </p>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("signUpTitle")}</CardTitle>
          <CardDescription>{t("signUpBody", {brand: BRAND})}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Badge variant={approval.variant}>
            <ApprovalIcon aria-hidden="true" />
            {t(`approval.${state}.label`)}
          </Badge>
          <p className="text-sm leading-6 text-[var(--color-muted-foreground)]">
            {t(`approval.${state}.text`, {brand: BRAND})}
          </p>
          {session.account_note ? (
            <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-muted)]/50 p-3">
              <p className="text-xs font-semibold uppercase tracking-[0.08em] text-[var(--color-muted-foreground)]">
                {t("noteFrom", {brand: BRAND})}
              </p>
              <p className="mt-1 text-sm leading-6">{session.account_note}</p>
            </div>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
