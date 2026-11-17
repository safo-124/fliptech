"use client";

import {formatCedis, formatDate} from "@/lib/format";
import {
  Building2,
  Camera,
  Check,
  Clock,
  GraduationCap,
  Heart,
  Loader2,
  LogOut,
  MessageCircle,
  Package,
  Store,
  Trash2,
  UserRound,
} from "lucide-react";
import Link from "next/link";
import {useRouter, useSearchParams} from "next/navigation";
import {useTranslations} from "next-intl";
import {useCallback, useEffect, useState} from "react";

import {AccountExtras} from "@/components/account/AccountExtras";
import {AccountSections} from "@/components/account/AccountSections";
import {LearningCard} from "@/components/account/LearningCard";
import {AccountSecurity} from "@/components/account/AccountSecurity";
import {PhoneSignIn, WelcomeStep} from "@/components/auth/PhoneSignIn";
import {announceSessionChange} from "@/lib/sign-in";
import {TrainerApiError} from "@/lib/trainer-fetch";
import styles from "@/components/account/photo.module.css";
import {Button} from "@/components/ui/button";
import {Card, CardContent, CardDescription, CardHeader, CardTitle} from "@/components/ui/card";
import {Input} from "@/components/ui/input";
import {Label} from "@/components/ui/label";
import {
  addRole,
  closeAccount,
  getAccount,
  getMyOrders,
  getMyQuestions,
  removeAccountPhoto,
  setAccountPhoto,
  signOutAccount,
  updateAccount,
  type AccountSession,
  type CustomerAccount,
  type MyQuestions,
} from "@/lib/account-api";
import {syncSavedWithAccount} from "@/lib/bag";
import {mergeBasketAfterSignIn} from "@/lib/basket";
import type {MarketplaceOrder} from "@/lib/types";

/** A path on this site, never somewhere else: `next` comes from the address. */
function safeNext(value: string | null) {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")) return null;
  return value;
}

function day(iso: string) {
  return formatDate(iso);
}

/**
 * /account: the one place everyone signs in, and what they see afterwards.
 *
 * Signed out, a phone and a code, nothing else: buying needs no more, and
 * an account is made on first use. Signed in, their details, what they
 * bought and asked, and the way to become a trainee, trainer or seller on the
 * same login.
 */
export function AccountPage() {
  const t = useTranslations("Account");
  const params = useSearchParams();
  const router = useRouter();
  const next = safeNext(params.get("next"));
  const [session, setSession] = useState<AccountSession | null>(null);

  const load = useCallback(async () => {
    const found = await getAccount();
    setSession(found);
    if (found.authenticated) {
      void syncSavedWithAccount();
      void mergeBasketAfterSignIn();
    }
    return found;
  }, []);

  useEffect(() => {
    let active = true;
    getAccount()
      .then((found) => {
        if (!active) return;
        setSession(found);
        if (found.authenticated) {
      void syncSavedWithAccount();
      void mergeBasketAfterSignIn();
    }
      })
      .catch(() => {
        if (active) setSession({authenticated: false, account: null, roles: null});
      });
    return () => {
      active = false;
    };
  }, []);

  if (session === null) {
    return (
      <div className="grid place-items-center py-24">
        <Loader2 aria-hidden="true" className="size-6 animate-spin text-[var(--color-muted-foreground)]" />
      </div>
    );
  }

  if (!session.authenticated) {
    return (
      <SignIn
        newcomer={params.get("new") === "1"}
        onSignedIn={async () => {
          await load();
          if (next) router.replace(next);
        }}
        // The number already has an account: the page becomes Sign in (the
        // code is sent from there), keeping where they were going.
        onAlreadyRegistered={() =>
          router.replace(next ? `/account?next=${encodeURIComponent(next)}` : "/account")
        }
      />
    );
  }

  // Signed in but the welcome step never finished: no name and nothing
  // chosen. Show it again rather than the dashboard, whatever interrupted it
  // (a reload, a slow connection, the page remounting). It goes only when
  // they press Continue.
  if (!session.account.display_name && session.account.interests.length === 0) {
    return (
      <div className="mx-auto max-w-md">
        <Card className="mt-2">
          <CardContent className="pt-5">
            <WelcomeStep
              idPrefix="account-welcome"
              onSaved={async () => {
                announceSessionChange();
                await load();
                if (next) router.replace(next);
              }}
            />
          </CardContent>
        </Card>
      </div>
    );
  }

  return <SignedIn session={session} reload={load} onSignedOut={() => setSession({authenticated: false, account: null, roles: null})} t={t} />;
}

// ---------------------------------------------------------------------------

function SignIn({
  newcomer,
  onSignedIn,
  onAlreadyRegistered,
}: {
  newcomer: boolean;
  onSignedIn: () => Promise<void>;
  onAlreadyRegistered: () => void;
}) {
  const t = useTranslations("Account");
  return (
    <div className="mx-auto max-w-md">
      <h1 className="text-3xl font-bold tracking-[-0.035em]">{newcomer ? t("joinTitle") : t("signInTitle")}</h1>
      <p className="mt-2 text-sm leading-6 text-[var(--color-muted-foreground)]">
        {newcomer ? t("joinLead") : t("signInLead")}
      </p>
      <Card className="mt-5">
        <CardContent className="pt-5">
          <PhoneSignIn
            idPrefix="account"
            register={newcomer}
            onAlreadyRegistered={onAlreadyRegistered}
            onDone={onSignedIn}
          />
        </CardContent>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------

type T = ReturnType<typeof useTranslations<"Account">>;

/**
 * Their picture, and the buttons to add, change or remove it. After a
 * change the page reloads, so the header (which asks once per page) shows
 * the new one too.
 */
function AccountPhoto({account, t, children}: {account: CustomerAccount; t: T; children: React.ReactNode}) {
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  async function change(action: () => Promise<unknown>) {
    setBusy(true);
    setProblem(null);
    try {
      await action();
      window.location.reload();
    } catch (reason) {
      setProblem(reason instanceof Error ? reason.message : t("failed"));
      setBusy(false);
    }
  }

  const initial = (account.display_name || "?").trim().slice(0, 1).toUpperCase();
  return (
    <div className="flex w-full min-w-0 items-center gap-4 sm:w-auto sm:flex-1">
      <span className="relative grid size-16 shrink-0 place-items-center overflow-hidden rounded-full bg-[var(--color-brand-soft)] text-2xl font-extrabold text-[var(--color-brand)] ring-4 ring-white shadow-[var(--shadow-card)]">
        {account.photo ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={account.photo} alt="" className="size-full object-cover" />
        ) : (
          initial
        )}
        {busy ? (
          <span className={`${styles.busy} absolute inset-0 grid place-items-center`}>
            <Loader2 aria-hidden="true" className="size-6 animate-spin text-white" />
          </span>
        ) : null}
      </span>
      <div className="min-w-0 flex-1">
        {children}
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <label className={`${styles.pick} inline-flex min-h-9 cursor-pointer items-center gap-1.5 rounded-full border border-[var(--color-border)] px-3 text-sm font-semibold hover:border-[var(--color-brand)]/40`}>
            <Camera aria-hidden="true" className="size-4 text-[var(--color-brand)]" />
            {account.photo ? t("changePhoto") : t("addPhoto")}
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="sr-only"
              disabled={busy}
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void change(() => setAccountPhoto(file));
              }}
            />
          </label>
          {account.photo ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => void change(removeAccountPhoto)}
              className="inline-flex min-h-9 items-center rounded-full px-3 text-sm font-semibold text-[var(--color-muted-foreground)] hover:text-[var(--color-destructive)]"
            >
              {t("removePhoto")}
            </button>
          ) : null}
        </div>
        <p className="mt-1 text-xs text-[var(--color-muted-foreground)]">{t("photoHint")}</p>
        {problem ? (
          <p role="alert" className="text-xs text-[var(--color-destructive)]">
            {problem}
          </p>
        ) : null}
      </div>
    </div>
  );
}

function SignedIn({
  session,
  reload,
  onSignedOut,
  t,
}: {
  session: Extract<AccountSession, {authenticated: true}>;
  reload: () => Promise<AccountSession>;
  onSignedOut: () => void;
  t: T;
}) {
  const router = useRouter();
  const {account, roles} = session;
  const [orders, setOrders] = useState<MarketplaceOrder[] | null>(null);
  const [asked, setAsked] = useState<MyQuestions | null>(null);
  const [details, setDetails] = useState({
    display_name: account.display_name,
    email: account.email ?? "",
    delivery_address: account.delivery_address,
  });
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  // The details form answers next to itself, not at the top of the page
  // where a phone has scrolled it out of sight.
  const [detailsState, setDetailsState] = useState<
    {saved: true} | {problem: string; field?: "email" | "display_name" | "delivery_address"} | null
  >(null);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    Promise.all([getMyOrders(), getMyQuestions()])
      .then(([found, questions]) => {
        if (!active) return;
        setOrders(found.results);
        setAsked(questions);
      })
      .catch(() => {
        if (active) setOrders([]);
      });
    return () => {
      active = false;
    };
  }, []);

  async function act(key: string, action: () => Promise<unknown>, done?: string) {
    setBusy(key);
    setProblem(null);
    setMessage(null);
    try {
      await action();
      if (done) setMessage(done);
    } catch (reason) {
      setProblem(reason instanceof Error ? reason.message : t("failed"));
    }
    setBusy(null);
  }

  async function become(role: "trainee" | "trainer" | "seller", href: string) {
    await act(role, async () => {
      await addRole(role);
      router.push(href);
    });
  }

  const ticked = (role: "trainee" | "trainer" | "seller") =>
    account.interests.includes(({trainee: "learn", trainer: "teach", seller: "sell"} as const)[role]);

  const roleCards = [
    {
      role: "trainee" as const,
      Icon: GraduationCap,
      state: roles.trainee,
      href: "/account/learning",
    },
    {
      role: "trainer" as const,
      Icon: Building2,
      state: roles.trainer,
      href: "/trainer/dashboard",
    },
    {
      role: "seller" as const,
      Icon: Store,
      state: roles.seller,
      href: "/sell/shop",
    },
    // What they ticked when they joined comes first: "Teach a trade" puts
    // setting up a workshop ahead of the other two. The sort keeps the
    // usual order otherwise.
  ].sort((a, b) => Number(ticked(b.role)) - Number(ticked(a.role)));

  const learns = Boolean(roles.trainee) || account.interests.includes("learn");
  const learnFirst = learns && account.interests[0] === "learn";
  const learning = learns ? <LearningCard /> : null;

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <AccountSections current="account" />
      <header className="flex flex-wrap items-end justify-between gap-3">
        <AccountPhoto account={account} t={t}>
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--color-brand-strong)]">{t("eyebrow")}</p>
          <h1 className="truncate text-3xl font-bold tracking-[-0.035em]">
            {account.display_name || t("hello")}
          </h1>
          <p className="mt-1 text-sm text-[var(--color-muted-foreground)]">{t("signedInAs", {phone: account.phone})}</p>
        </AccountPhoto>
        <Button
          type="button"
          variant="outline"
          disabled={busy !== null}
          onClick={() =>
            act("out", async () => {
              await signOutAccount();
              onSignedOut();
            })
          }
        >
          <LogOut aria-hidden="true" />
          {t("signOut")}
        </Button>
      </header>
      <AccountExtras />

      {message ? (
        <p role="status" className="rounded-lg bg-[var(--color-visit-bg)] px-3 py-2 text-sm text-[var(--color-visit)]">
          {message}
        </p>
      ) : null}
      {problem ? (
        <p role="alert" className="rounded-lg bg-[var(--color-destructive)]/10 px-3 py-2 text-sm text-[var(--color-destructive)]">
          {problem}
        </p>
      ) : null}

      {/* Learning and shopping, in the order they said brought them:
          "Learn a trade" first puts courses on top. Learning shows for anyone
          who is a trainee or ticked it; shopping for everyone (every login
          can buy). */}
      {learnFirst ? learning : null}
      <section aria-label={t("shoppingTitle")} className="space-y-5">
      {/* ------------------------------------------------------- orders */}
      <Card id="orders" className="scroll-mt-24">
        <CardHeader className="flex-row items-center gap-3 space-y-0">
          <Package aria-hidden="true" className="size-5 text-[var(--color-brand)]" />
          <CardTitle>{t("ordersTitle")}</CardTitle>
        </CardHeader>
        <CardContent>
          {orders === null ? (
            <Loader2 aria-hidden="true" className="size-5 animate-spin text-[var(--color-muted-foreground)]" />
          ) : orders.length ? (
            <ul className="divide-y divide-[var(--color-border)]">
              {orders.map((order) => (
                <li key={order.reference}>
                  <Link
                    href={`/marketplace/order/${order.reference}`}
                    className="flex flex-wrap items-center justify-between gap-2 py-3 hover:text-[var(--color-brand)]"
                  >
                    <span className="min-w-0">
                      <span className="block text-sm font-semibold">{order.product_name}</span>
                      <span className="block text-xs text-[var(--color-muted-foreground)]">
                        {order.seller_name} · {order.paid_at ? day(order.paid_at) : ""} · {t(`stage.${order.stage}`)}
                      </span>
                    </span>
                    <span className="text-sm font-bold tabular-nums">{formatCedis(order.amount)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-[var(--color-muted-foreground)]">
              {t("noOrders")}{" "}
              <Link href="/marketplace" className="font-semibold text-[var(--color-brand)] hover:underline">
                {t("browseMarketplace")}
              </Link>
            </p>
          )}
        </CardContent>
      </Card>

      {/* ---------------------------------------------- questions & quotes */}
      {asked && (asked.questions.length || asked.quotes.length) ? (
        <Card id="questions" className="scroll-mt-24">
          <CardHeader className="flex-row items-center gap-3 space-y-0">
            <MessageCircle aria-hidden="true" className="size-5 text-[var(--color-brand)]" />
            <CardTitle>{t("questionsTitle")}</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="divide-y divide-[var(--color-border)] text-sm">
              {asked.quotes.map((quote) => (
                <li key={quote.reference} className="py-3">
                  <p className="font-semibold">{t("quoteLine", {title: quote.title})}</p>
                  <p className="text-xs text-[var(--color-muted-foreground)]">
                    {quote.makers.length
                      ? t("quoteMakers", {makers: quote.makers.join(", ")})
                      : t("quoteWaiting")}
                  </p>
                </li>
              ))}
              {asked.questions.map((question) => (
                <li key={question.reference} className="py-3">
                  <p className="font-semibold">
                    {question.product ? (
                      <Link href={`/marketplace/${question.product}`} className="hover:underline">
                        {question.product_name}
                      </Link>
                    ) : (
                      question.product_name
                    )}
                  </p>
                  <p className="text-xs text-[var(--color-muted-foreground)]">
                    {question.seller_name} · {day(question.created_at)}
                    {question.message ? ` · “${question.message}”` : ""}
                  </p>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}

      <p>
        <Link href="/marketplace/saved" className="inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-[var(--color-brand)] hover:underline">
          <Heart aria-hidden="true" className="size-4" />
          {t("savedLink")}
        </Link>
      </p>
      </section>
      {learnFirst ? null : learning}

      {/* ------------------------------------------------- more you can do */}
      <Card>
        <CardHeader>
          <CardTitle>{t("moreTitle")}</CardTitle>
          <CardDescription>{t("moreLead")}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-3">
          {roleCards.map(({role, Icon, state, href}) => (
            <div key={role} className="flex flex-col rounded-xl border border-[var(--color-border)] p-4">
              <Icon aria-hidden="true" className="size-5 text-[var(--color-brand)]" />
              <p className="mt-2 font-semibold">{t(`role.${role}.title`)}</p>
              <p className="mt-1 flex-1 text-xs leading-5 text-[var(--color-muted-foreground)]">
                {state ? (state.status === "pending" ? t("pending") : t(`role.${role}.have`)) : t(`role.${role}.lead`)}
              </p>
              {state ? (
                <Button asChild size="sm" variant="outline" className="mt-3">
                  <Link href={state.href}>
                    {state.status === "pending" ? <Clock aria-hidden="true" /> : null}
                    {t(`role.${role}.open`)}
                  </Link>
                </Button>
              ) : (
                <Button
                  type="button"
                  size="sm"
                  variant="brand"
                  className="mt-3"
                  disabled={busy !== null}
                  onClick={() => become(role, href)}
                >
                  {busy === role ? <Loader2 aria-hidden="true" className="animate-spin" /> : null}
                  {t(`role.${role}.start`)}
                </Button>
              )}
            </div>
          ))}
        </CardContent>
      </Card>

      {/* --------------------------------------------------- your details */}
      <Card id="details" className="scroll-mt-24">
        <CardHeader className="flex-row items-center gap-3 space-y-0">
          <UserRound aria-hidden="true" className="size-5 text-[var(--color-brand)]" />
          <CardTitle>{t("detailsTitle")}</CardTitle>
        </CardHeader>
        <CardContent>
          <form
            noValidate
            onSubmit={async (event) => {
              event.preventDefault();
              setDetailsState(null);
              const email = details.email.trim();
              // name@place.tld: the browser's own check lets "name@place" through.
              if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
                setDetailsState({problem: t("emailInvalid"), field: "email"});
                document.getElementById("details-email")?.focus();
                return;
              }
              setBusy("details");
              try {
                await updateAccount({
                  display_name: details.display_name.trim(),
                  email: email || null,
                  delivery_address: details.delivery_address.trim(),
                });
                await reload();
                setDetailsState({saved: true});
              } catch (reason) {
                const fields = reason instanceof TrainerApiError ? reason.fields : {};
                const field = (["email", "display_name", "delivery_address"] as const).find(
                  (name) => fields[name],
                );
                setDetailsState({
                  problem:
                    (field && fields[field]) ||
                    (reason instanceof TrainerApiError && reason.status === 0
                      ? t("detailsOffline")
                      : reason instanceof Error
                        ? reason.message
                        : t("failed")),
                  field,
                });
              }
              setBusy(null);
            }}
            className="space-y-4"
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <Label htmlFor="details-name">{t("nameLabel")}</Label>
                <Input
                  id="details-name"
                  autoComplete="name"
                  value={details.display_name}
                  onChange={(event) => setDetails({...details, display_name: event.target.value})}
                />
              </div>
              <div>
                <Label htmlFor="details-email">{t("emailLabel")}</Label>
                <Input
                  id="details-email"
                  type="email"
                  inputMode="email"
                  autoComplete="email"
                  value={details.email}
                  aria-invalid={detailsState && "field" in detailsState && detailsState.field === "email" ? true : undefined}
                  aria-describedby={
                    detailsState && "field" in detailsState && detailsState.field === "email" ? "details-email-error" : undefined
                  }
                  onChange={(event) => {
                    setDetails({...details, email: event.target.value});
                    setDetailsState(null);
                  }}
                />
                {detailsState && "field" in detailsState && detailsState.field === "email" ? (
                  <p id="details-email-error" className="mt-1.5 text-xs font-medium text-[var(--color-destructive)]">
                    {detailsState.problem}
                  </p>
                ) : null}
              </div>
            </div>
            <div>
              <Label htmlFor="details-address">{t("addressLabel")}</Label>
              <Input
                id="details-address"
                autoComplete="street-address"
                value={details.delivery_address}
                onChange={(event) => setDetails({...details, delivery_address: event.target.value})}
                placeholder={t("addressPlaceholder")}
              />
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <Button type="submit" variant="brand" disabled={busy !== null}>
                {busy === "details" ? <Loader2 aria-hidden="true" className="animate-spin" /> : null}
                {busy === "details" ? t("savingDetails") : t("saveDetails")}
              </Button>
              <span role="status" aria-live="polite" className="text-sm">
                {detailsState && "saved" in detailsState ? (
                  <span className="inline-flex items-center gap-1.5 font-semibold text-[var(--color-visit)]">
                    <Check aria-hidden="true" className="size-4" />
                    {t("detailsSaved")}
                  </span>
                ) : null}
              </span>
            </div>
            {detailsState && "problem" in detailsState && detailsState.field !== "email" ? (
              <p role="alert" className="rounded-lg bg-[var(--color-destructive)]/10 px-3 py-2 text-sm text-[var(--color-destructive)]">
                {detailsState.problem}
              </p>
            ) : null}
          </form>
        </CardContent>
      </Card>

      <AccountSecurity account={account} reload={reload} />

      <CloseAccount onClosed={() => {
        onSignedOut();
        router.replace("/");
      }} />
    </div>
  );
}

/**
 * The one Close account, for the whole login. What it deletes and what it
 * keeps is said before the button, in the words of accounts/closing.py.
 */
function CloseAccount({onClosed}: {onClosed: () => void}) {
  const t = useTranslations("Account");
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  return (
    <Card id="close" className="scroll-mt-24 border-[var(--color-destructive)]/25">
      <CardHeader className="flex-row items-center gap-3 space-y-0">
        <Trash2 aria-hidden="true" className="size-5 text-[var(--color-destructive)]" />
        <CardTitle>{t("closeTitle")}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm leading-6">
        <p>
          <strong>{t("closeDeletesLabel")}</strong> {t("closeDeletes")}
        </p>
        <p>
          <strong>{t("closeKeepsLabel")}</strong> {t("closeKeeps")}
        </p>
        <p className="text-[var(--color-muted-foreground)]">{t("closeNotHere")}</p>
        {problem ? (
          <p role="alert" className="rounded-lg bg-[var(--color-destructive)]/10 px-3 py-2 text-[var(--color-destructive)]">
            {problem}
          </p>
        ) : null}
        {asking ? (
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button
              type="button"
              variant="destructive"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                setProblem(null);
                try {
                  await closeAccount();
                  onClosed();
                } catch (reason) {
                  setProblem(reason instanceof Error ? reason.message : t("failed"));
                  setBusy(false);
                }
              }}
            >
              {busy ? <Loader2 aria-hidden="true" className="animate-spin" /> : null}
              {t("closeConfirm")}
            </Button>
            <Button type="button" variant="ghost" disabled={busy} onClick={() => setAsking(false)}>
              {t("closeKeep")}
            </Button>
          </div>
        ) : (
          <Button type="button" variant="outline" onClick={() => setAsking(true)}>
            {t("closeButton")}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
