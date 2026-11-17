"use client";

import {ArrowRight, Building2, Check, GraduationCap, Loader2, ShoppingBag, Store} from "lucide-react";
import {useTranslations} from "next-intl";
import {useEffect, useRef, useState} from "react";
import {ZodError} from "zod";

import {Button} from "@/components/ui/button";
import {Input} from "@/components/ui/input";
import {Label} from "@/components/ui/label";
import {PasswordSignIn} from "@/components/auth/PasswordSignIn";
import {
  addRole,
  getAccount,
  requestAccountCode,
  updateAccount,
  verifyAccountCode,
  type AccountSession,
} from "@/lib/account-api";
import {syncSavedWithAccount} from "@/lib/bag";
import {mergeBasketAfterSignIn} from "@/lib/basket";
import {readDraft, removeDraft, writeDraft} from "@/lib/drafts";
import {currentDraftOwner} from "@/lib/session-api";
import {TrainerApiError} from "@/lib/trainer-fetch";
import {ghanaPhoneSchema, toGhanaE164} from "@/lib/phone";
import {announceSessionChange} from "@/lib/sign-in";

export type Interest = "learn" | "teach" | "buy" | "sell";

const INTERESTS: {key: Interest; icon: typeof GraduationCap}[] = [
  {key: "learn", icon: GraduationCap},
  {key: "teach", icon: Building2},
  {key: "buy", icon: ShoppingBag},
  {key: "sell", icon: Store},
];

type SignInProps = {
  role?: "trainee";
  interest?: Interest;
  idPrefix?: string;
  /** The Create your account page: starts on creating an account. */
  register?: boolean;
  /** Called when a number that already has an account chooses to sign in. */
  onAlreadyRegistered?: () => void;
  onDone: (session: AccountSession, joined: boolean) => void | Promise<void>;
  /** The password form switched between sign in, create and forgot. */
  onModeChange?: (mode: "sign_in" | "register" | "forgot") => void;
};

/**
 * Signing in, the same everywhere: phone number or email and a password
 * (or creating an account, or a link to set a new password), and for someone
 * new one more screen, their name and what brought them.
 *
 * The phone code is offered too ("Send me a code instead") only while it is
 * switched on (backend PHONE_CODE_SIGN_IN): SMS codes cannot be relied on yet.
 *
 * `onDone` gets the session once they are in. `role: "trainee"` makes the
 * login a trainee too (for learning), and `interest` ticks that card in
 * advance on the welcome screen.
 */
export function PhoneSignIn(props: SignInProps) {
  const {role, interest, idPrefix = "sign-in", register = false, onDone} = props;
  const [useCode, setUseCode] = useState(false);
  const [codeOn, setCodeOn] = useState(false);
  const [welcome, setWelcome] = useState<{name: string} | null>(null);
  const chosen: Interest[] = interest ? [interest] : role === "trainee" ? ["learn"] : [];

  useEffect(() => {
    let active = true;
    // Also hands out the CSRF cookie the sign-in needs.
    getAccount()
      .then((session) => active && setCodeOn(Boolean(session.sign_in?.code)))
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  if (welcome) {
    return (
      <WelcomeStep
        idPrefix={idPrefix}
        initialName={welcome.name}
        initialChosen={chosen}
        onSaved={(session) => finishSignIn(session, true, role, onDone)}
      />
    );
  }
  if (useCode && codeOn) return <CodeSignIn {...props} />;
  return (
    <PasswordSignIn
      idPrefix={idPrefix}
      initialMode={register ? "register" : "sign_in"}
      onModeChange={props.onModeChange}
      onUseCode={codeOn ? () => setUseCode(true) : undefined}
      onSignedIn={async (session, joined) => {
        // Someone new (or with no name yet): their name and what brought them.
        if (joined || (session.authenticated && !session.account.display_name)) {
          setWelcome({name: session.authenticated ? session.account.display_name : ""});
          return;
        }
        await finishSignIn(session, false, role, onDone);
      }}
    />
  );
}

/** What every way of signing in does once the person is in. */
async function finishSignIn(
  session: AccountSession,
  joined: boolean,
  role: "trainee" | undefined,
  onDone: SignInProps["onDone"],
) {
  void syncSavedWithAccount();
  void mergeBasketAfterSignIn();
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

/** The phone and the code: only while the code is switched on. */
function CodeSignIn({
  role,
  interest,
  idPrefix = "sign-in",
  register = false,
  onAlreadyRegistered,
  onDone,
}: SignInProps) {
  const t = useTranslations("SignIn");
  const [step, setStep] = useState<"phone" | "code" | "welcome">("phone");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [challenge, setChallenge] = useState("");
  const [chosen] = useState<Interest[]>(
    interest ? [interest] : role === "trainee" ? ["learn"] : [],
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exists, setExists] = useState(false);
  // The code screen: how long the code lasts, how many digits it has, and
  // when another may be sent.
  const [codeLength, setCodeLength] = useState(6);
  const [expiresIn, setExpiresIn] = useState(0);
  const [resendIn, setResendIn] = useState(0);
  const [resent, setResent] = useState(false);

  useEffect(() => {
    if (step !== "code") return;
    const timer = window.setInterval(() => {
      setExpiresIn((seconds) => Math.max(0, seconds - 1));
      setResendIn((seconds) => Math.max(0, seconds - 1));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [step]);

  function problem(reason: unknown) {
    if (reason instanceof ZodError) return t("phoneInvalid");
    return reason instanceof Error ? reason.message : t("failed");
  }

  async function finish(session: AccountSession, joined: boolean) {
    await finishSignIn(session, joined, role, onDone);
  }

  async function sendCode(intent?: "register") {
    setBusy(true);
    setError(null);
    setExists(false);
    try {
      const sent = await requestAccountCode(toGhanaE164(ghanaPhoneSchema.parse(phone)), intent);
      setChallenge(sent.challenge_id);
      setCodeLength(sent.code_length ?? 6);
      setExpiresIn(sent.expires_in_seconds ?? 600);
      setResendIn(RESEND_SECONDS);
      setStep("code");
    } catch (reason) {
      // Registering a number that already has an account: no code was sent.
      // Say so, and offer to sign in with it instead.
      const body = reason instanceof TrainerApiError ? (reason.body as {code?: string} | null) : null;
      if (reason instanceof TrainerApiError && reason.status === 409 && body?.code === "account_exists") {
        setExists(true);
      } else {
        setError(problem(reason));
      }
    }
    setBusy(false);
  }

  function send(event: React.FormEvent) {
    event.preventDefault();
    void sendCode(register ? "register" : undefined);
  }

  function signInInstead() {
    onAlreadyRegistered?.();
    void sendCode();
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
      <WelcomeStep
        idPrefix={idPrefix}
        initialName={name}
        initialChosen={chosen}
        onSaved={(session) => finish(session, true)}
      />
    );
  }

  // No `name` attributes, so a tap before hydration cannot put a phone number
  // in the address bar.
  return step === "phone" ? (
    <form onSubmit={send} className="space-y-4">
      {alert}
      {exists ? (
        <div role="alert" className="space-y-2 rounded-lg bg-[var(--color-warn-bg)] px-3 py-3 text-sm text-[var(--color-warn)]">
          <p className="font-semibold">{t("numberExists")}</p>
          <Button type="button" variant="brand" size="sm" disabled={busy} onClick={signInInstead}>
            {t("signInInstead")}
            <ArrowRight aria-hidden />
          </Button>
        </div>
      ) : null}
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
      <p className="text-sm text-[var(--color-muted-foreground)]">
        {resent ? t("codeResentTo", {phone}) : t("codeSentTo", {phone})}{" "}
        {t("codeRules", {digits: codeLength, minutes: Math.max(1, Math.round((expiresIn || 600) / 60))})}
      </p>
      <div>
        <Label htmlFor={`${idPrefix}-code`}>{t("codeLabelDigits", {digits: codeLength})}</Label>
        <Input
          id={`${idPrefix}-code`}
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9]*"
          maxLength={codeLength}
          required
          autoFocus
          value={code}
          onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, codeLength))}
          aria-describedby={`${idPrefix}-code-timer`}
        />
        <p id={`${idPrefix}-code-timer`} className="mt-1.5 text-xs text-[var(--color-muted-foreground)]" aria-live="polite">
          {expiresIn > 0 ? t("codeExpiresIn", {time: clock(expiresIn)}) : t("codeExpired")}
        </p>
      </div>
      <Button type="submit" variant="brand" className="w-full" disabled={busy || code.length < codeLength}>
        {busy ? <Loader2 aria-hidden className="animate-spin" /> : null}
        {register ? t("createAccount") : t("signIn")}
      </Button>
      <Button
        type="button"
        variant="outline"
        className="w-full"
        disabled={busy || resendIn > 0}
        onClick={async () => {
          setCode("");
          await sendCode(register ? "register" : undefined);
          setResent(true);
        }}
      >
        {resendIn > 0 ? t("resendIn", {time: clock(resendIn)}) : t("resend")}
      </Button>
      <Button type="button" variant="ghost" className="w-full" onClick={() => setStep("phone")}>
        {t("changeNumber")}
      </Button>
    </form>
  );
}

const WELCOME_DRAFT = "welcome";

/** Long enough for a slow text to land before tempting a second one. */
const RESEND_SECONDS = 45;

/** 125 seconds as "2:05". */
function clock(seconds: number) {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

/**
 * The newcomer's one extra screen: their first name and what brought them.
 *
 * Its own component so the account page can show it too. Whatever happens
 * between the code and Continue (a slow connection, a reload, the page
 * remounting), an account with no name and nothing chosen lands back here
 * rather than on the dashboard, and what was typed is kept as this person's
 * draft. It goes only when Continue is pressed.
 */
export function WelcomeStep({
  idPrefix = "welcome",
  initialName = "",
  initialChosen = [],
  onSaved,
}: {
  idPrefix?: string;
  initialName?: string;
  initialChosen?: Interest[];
  onSaved: (session: AccountSession) => void | Promise<void>;
}) {
  const t = useTranslations("SignIn");
  const [name, setName] = useState(initialName);
  const [chosen, setChosen] = useState<Interest[]>(initialChosen);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const owner = useRef<string | null>(null);
  const choicesRef = useRef<HTMLDivElement>(null);

  // A draft from this same person, if the step was interrupted.
  useEffect(() => {
    let active = true;
    currentDraftOwner().then((who) => {
      if (!active) return;
      owner.current = who;
      const saved = readDraft<{name: string; chosen: Interest[]}>(WELCOME_DRAFT, who);
      if (saved) {
        setName((current) => current || saved.name || "");
        setChosen((current) => (current.length ? current : (saved.chosen ?? [])));
      }
    });
    return () => {
      active = false;
    };
  }, []);

  function remember(next: {name: string; chosen: Interest[]}) {
    if (owner.current) writeDraft(WELCOME_DRAFT, owner.current, next);
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    // At least one choice: the button waits for it, and so does Enter.
    if (chosen.length === 0) {
      setError(t("pickOne"));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const session = await updateAccount({
        ...(name.trim() ? {display_name: name.trim()} : {}),
        interests: chosen,
      });
      removeDraft(WELCOME_DRAFT);
      await onSaved(session);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t("failed"));
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

  return (
      <form onSubmit={submit} className="space-y-5">
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
            onChange={(event) => {
              setName(event.target.value);
              remember({name: event.target.value, chosen});
            }}
            // A phone keyboard's Go key is Enter. Here it moves on to the
            // choices instead of sending a half-finished step.
            enterKeyHint="next"
            onKeyDown={(event) => {
              if (event.key !== "Enter") return;
              event.preventDefault();
              choicesRef.current?.querySelector<HTMLButtonElement>("button")?.focus();
            }}
            placeholder={t("namePlaceholder")}
          />
        </div>
        <fieldset>
          <legend className="text-sm font-semibold">{t("interestsTitle")}</legend>
          <p className="text-xs text-[var(--color-muted-foreground)]">{t("interestsHint")}</p>
          <div ref={choicesRef} className="mt-3 grid gap-2">
            {INTERESTS.map(({key, icon: Icon}) => {
              const on = chosen.includes(key);
              return (
                <button
                  key={key}
                  type="button"
                  role="checkbox"
                  aria-checked={on}
                  onClick={() => {
                    const next = on ? chosen.filter((item) => item !== key) : [...chosen, key];
                    setChosen(next);
                    remember({name, chosen: next});
                  }}
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
        <Button type="submit" variant="brand" className="w-full" disabled={busy || chosen.length === 0}>
          {busy ? <Loader2 aria-hidden className="animate-spin" /> : null}
          {t("continue")}
          {busy ? null : <ArrowRight aria-hidden />}
        </Button>
      </form>
  );
}
