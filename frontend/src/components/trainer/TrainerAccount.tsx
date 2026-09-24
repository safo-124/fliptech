"use client";

import {CheckCircle2, Clock3, Loader2, Mail, MailCheck, Phone, ShieldX} from "lucide-react";
import {useState} from "react";

import {Badge} from "@/components/ui/badge";
import {Button} from "@/components/ui/button";
import {Card, CardContent, CardDescription, CardHeader, CardTitle} from "@/components/ui/card";
import {Input} from "@/components/ui/input";
import {Label} from "@/components/ui/label";
import {confirmTrainerAddEmail, requestTrainerAddEmailCode} from "@/lib/trainer-api";
import type {TrainerSession} from "@/lib/types";

type SignedIn = Extract<TrainerSession, {authenticated: true}>;

const APPROVAL: Record<
  string,
  {label: string; variant: "default" | "secondary" | "warning"; Icon: typeof Clock3; text: string}
> = {
  confirmed: {
    label: "Confirmed",
    variant: "default",
    Icon: CheckCircle2,
    text: "Fliptech has confirmed your sign-up. Your listing can go public once it passes review.",
  },
  pending: {
    label: "Waiting for confirmation",
    variant: "warning",
    Icon: Clock3,
    text: "You can finish and submit your workshop profile now. It goes public only after your sign-up is confirmed and the profile is reviewed.",
  },
  declined: {
    label: "Not approved",
    variant: "warning",
    Icon: ShieldX,
    text: "Contact Fliptech if you think this is a mistake.",
  },
};

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
  const [draft, setDraft] = useState("");
  const [code, setCode] = useState("");
  const [challenge, setChallenge] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const approval = APPROVAL[session.account_status ?? "confirmed"] ?? APPROVAL.confirmed;
  const ApprovalIcon = approval.Icon;

  async function sendCode(event: React.FormEvent) {
    event.preventDefault();
    const address = draft.trim();
    if (!address.includes("@")) {
      setError("Enter your email address.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const next = await requestTrainerAddEmailCode(address);
      setChallenge(next.challenge_id);
      setCode("");
      setNotice(`We sent a code to ${address}.`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not send a code.");
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
      setNotice("Email added. You can sign in with it now.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "That code did not work.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>How you sign in</CardTitle>
          <CardDescription>
            No password. A one-time code goes to your phone, or to your email if you add one.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="flex items-start gap-3 rounded-xl border border-[var(--color-border)] p-3">
            <Phone aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-[var(--color-muted-foreground)]" />
            <div className="min-w-0">
              <p className="text-sm font-semibold">{session.phone}</p>
              <p className="mt-0.5 text-xs leading-5 text-[var(--color-muted-foreground)]">
                Your phone number is the account itself and cannot be changed here. It is private:
                trainees see the workshop&rsquo;s contact number, not this one.
              </p>
            </div>
          </div>

          {session.email ? (
            <div className="flex items-start gap-3 rounded-xl border border-[var(--color-visit)]/25 bg-[var(--color-visit-bg)] p-3">
              <MailCheck aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-[var(--color-visit)]" />
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold">{session.email}</p>
                <p className="mt-0.5 text-xs leading-5 text-[var(--color-muted-foreground)]">
                  Verified. You can sign in with this address when an SMS does not arrive.
                </p>
              </div>
            </div>
          ) : challenge ? (
            <form onSubmit={confirm} className="space-y-3">
              <div className="space-y-2">
                <Label htmlFor="trainer-email-code">Enter the code we sent to {draft.trim()}</Label>
                <Input
                  id="trainer-email-code"
                  value={code}
                  onChange={(event) => setCode(event.target.value)}
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  placeholder="6-digit code"
                  disabled={busy}
                />
              </div>
              <div className="flex flex-col gap-2 sm:flex-row">
                <Button type="submit" variant="brand" disabled={busy}>
                  {busy ? <Loader2 aria-hidden="true" className="animate-spin" /> : null}
                  Add this address
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
                  Use a different address
                </Button>
              </div>
            </form>
          ) : (
            <form onSubmit={sendCode} className="space-y-3">
              <div className="space-y-2">
                <Label htmlFor="trainer-email">Add an email address (optional)</Label>
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
                  A second way in when an SMS does not arrive, which on a prepaid network is
                  common. We send a code to prove the address is yours.
                </p>
              </div>
              <Button type="submit" variant="outline" disabled={busy}>
                {busy ? (
                  <Loader2 aria-hidden="true" className="animate-spin" />
                ) : (
                  <Mail aria-hidden="true" />
                )}
                Send me a code
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
          <CardTitle>Your sign-up</CardTitle>
          <CardDescription>
            Fliptech confirms every trainer before their listing can go public.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Badge variant={approval.variant}>
            <ApprovalIcon aria-hidden="true" />
            {approval.label}
          </Badge>
          <p className="text-sm leading-6 text-[var(--color-muted-foreground)]">{approval.text}</p>
          {session.account_note ? (
            <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-muted)]/50 p-3">
              <p className="text-xs font-semibold uppercase tracking-[0.08em] text-[var(--color-muted-foreground)]">
                Note from Fliptech
              </p>
              <p className="mt-1 text-sm leading-6">{session.account_note}</p>
            </div>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
