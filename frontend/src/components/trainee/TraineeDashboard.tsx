"use client";

import {
  AlertCircle,
  ArrowRight,
  CalendarDays,
  CheckCircle2,
  Headset,
  Loader2,
  Mail,
  MailCheck,
  LogOut,
  MessageCircle,
  MessageSquareOff,
  Search,
  Trash2,
  UserRound,
} from "lucide-react";
import Link from "next/link";
import {useRouter} from "next/navigation";
import {useEffect, useState} from "react";

import type {TraineeTab} from "@/components/trainee/TraineeNav";
import {TraineeBottomBar, TraineeSidebar} from "@/components/trainee/TraineeNav";
import {TraineeOverview} from "@/components/trainee/TraineeOverview";
import {Badge} from "@/components/ui/badge";
import {Button} from "@/components/ui/button";
import {Card, CardContent, CardDescription, CardHeader, CardTitle} from "@/components/ui/card";
import {Input} from "@/components/ui/input";
import {Label} from "@/components/ui/label";
import {NativeSelect} from "@/components/ui/native-select";
import {Skeleton} from "@/components/ui/skeleton";
import {browserApiUrl} from "@/lib/api-origin";
import {formatDate, formatFee} from "@/lib/format";
import {awaitingReply, matchesQuery} from "@/lib/trainee-progress";
import {cn} from "@/lib/utils";
import {
  closeTraineeAccount,
  confirmAddEmail,
  getSavedProviders,
  getTraineeEnquiries,
  getTraineeEnrolments,
  getTraineeSession,
  logoutTrainee,
  removeSavedProvider,
  requestAddEmailCode,
  updateTraineeAccount,
} from "@/lib/trainee-api";
import type {
  SavedProvider,
  TraineeChannel,
  TraineeEducationLevel,
  TraineeEducationStatus,
  TraineeEnquiry,
  TraineeEnquiryStatus,
  TraineeEnrolment,
  TraineeProviderLink,
  TraineeSession,
} from "@/lib/types";

const STATUS: Record<TraineeEnquiryStatus, {label: string; variant: "secondary" | "warning" | "default"}> = {
  sent: {label: "Sent to the workshop", variant: "secondary"},
  replied: {label: "Workshop replied", variant: "default"},
  visited: {label: "You visited", variant: "default"},
  enrolled: {label: "Enrolled", variant: "default"},
  not_delivered: {label: "Not delivered", variant: "warning"},
};

/** Short enough to sit in a row of chips on a phone. */
const FILTERS: Array<{key: TraineeEnquiryStatus | "all"; label: string}> = [
  {key: "all", label: "All"},
  {key: "sent", label: "Waiting" },
  {key: "replied", label: "Replied"},
  {key: "visited", label: "Visited"},
  {key: "enrolled", label: "Enrolled"},
  {key: "not_delivered", label: "Not delivered"},
];

/**
 * The tab the URL asks for, so a refresh and a back button land where the
 * trainee was. A hash rather than a query parameter: it needs no Suspense
 * boundary and never reaches the server, which has no business knowing which
 * tab of their own account someone is reading.
 */
function tabFromHash(): TraineeTab | null {
  if (typeof window === "undefined") return null;
  const value = window.location.hash.replace(/^#/, "");
  const allowed: TraineeTab[] = ["overview", "enquiries", "training", "saved", "settings"];
  return (allowed as string[]).includes(value) ? (value as TraineeTab) : null;
}

function SearchBox({
  value,
  onChange,
  label,
  placeholder,
}: {
  value: string;
  onChange: (value: string) => void;
  label: string;
  placeholder: string;
}) {
  return (
    <div className="relative">
      <Search
        aria-hidden="true"
        className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[var(--color-muted-foreground)]"
      />
      <Input
        type="search"
        aria-label={label}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="pl-9"
      />
    </div>
  );
}

/** Shown when a filter or a search matches nothing, which is not the same
 *  thing as having nothing — that case keeps the Empty card and its call to
 *  go and find training. */
function NoMatches({onClear}: {onClear: () => void}) {
  return (
    <Card className="border-dashed p-6 text-center">
      <MessageSquareOff aria-hidden="true" className="mx-auto size-5 text-[var(--color-muted-foreground)]" />
      <p className="mt-3 font-semibold">Nothing matches</p>
      <p className="mt-1 text-sm text-[var(--color-muted-foreground)]">
        Try a different word, or clear the filter.
      </p>
      <Button type="button" variant="outline" className="mx-auto mt-4" onClick={onClear}>
        Clear filters
      </Button>
    </Card>
  );
}


function ProviderName({provider}: {provider: TraineeProviderLink}) {
  if (!provider.is_listed) {
    return (
      <span>
        {provider.name} <span className="font-normal text-[var(--color-muted-foreground)]">(no longer listed)</span>
      </span>
    );
  }
  return (
    <Link href={`/${provider.area_slug}/${provider.slug}`} className="underline-offset-4 hover:underline">
      {provider.name}
    </Link>
  );
}

function Empty({title, text}: {title: string; text: string}) {
  return (
    <Card className="border-dashed p-6 text-center">
      <p className="font-semibold">{title}</p>
      <p className="mt-1 text-sm text-[var(--color-muted-foreground)]">{text}</p>
      <Button asChild variant="outline" className="mx-auto mt-4">
        <Link href="/">
          Find training
          <ArrowRight aria-hidden="true" />
        </Link>
      </Button>
    </Card>
  );
}

function SupportBanner({
  support,
  onLeave,
  busy,
}: {
  support: NonNullable<Extract<TraineeSession, {authenticated: true}>["support"]>;
  onLeave: () => void;
  busy: boolean;
}) {
  const ends = new Date(support.expires_at).toLocaleTimeString([], {hour: "2-digit", minute: "2-digit"});
  return (
    <div
      role="status"
      className="sticky top-[4.5rem] z-50 mb-5 flex flex-col gap-3 rounded-2xl border-2 border-[var(--color-warn)] bg-[var(--color-warn-bg)] p-4 sm:flex-row sm:items-center sm:justify-between"
      data-support-banner
    >
      <div className="flex items-start gap-3">
        <Headset aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-[var(--color-warn)]" />
        <div className="text-sm leading-6">
          <p className="font-semibold">
            Support view: {support.staff_name} is viewing this account
            {support.can_edit ? " and can make changes" : " (view only)"}.
          </p>
          <p className="text-[var(--color-muted-foreground)]">
            Reason: {support.reason}. Ends at {ends}. Every page opened is logged.
          </p>
        </div>
      </div>
      <Button type="button" variant="outline" onClick={onLeave} disabled={busy} className="shrink-0">
        {busy ? <Loader2 aria-hidden="true" className="animate-spin" /> : <LogOut aria-hidden="true" />}
        Leave support view
      </Button>
    </div>
  );
}

/** The optional background block, saved and reset as one unit. */
type TraineeBackground = {
  education_level: TraineeEducationLevel | "";
  institution_name: string;
  field_of_study: string;
  education_status: TraineeEducationStatus | "";
  education_year: number | null;
};

export function TraineeDashboard() {
  const router = useRouter();
  const [session, setSession] = useState<Extract<TraineeSession, {authenticated: true}> | null>(null);
  const [enquiries, setEnquiries] = useState<TraineeEnquiry[]>([]);
  const [enrolments, setEnrolments] = useState<TraineeEnrolment[]>([]);
  const [saved, setSaved] = useState<SavedProvider[]>([]);
  const [tab, setTab] = useState<TraineeTab>("overview");
  const [statusFilter, setStatusFilter] = useState<TraineeEnquiryStatus | "all">("all");
  const [enquiryQuery, setEnquiryQuery] = useState("");
  const [savedQuery, setSavedQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [channel, setChannel] = useState<TraineeChannel>("whatsapp");
  // One object rather than five useStates: it is saved and reset as a unit,
  // and five setters in the load effect is five chances to forget one.
  // Adding an address is its own two-step flow: type it, then prove it with a
  // code. It is not part of saveSettings, because an address is claimed by
  // proving it and not by typing it into a form the server would have to take
  // on trust.
  const [emailDraft, setEmailDraft] = useState("");
  const [emailCode, setEmailCode] = useState("");
  const [emailChallenge, setEmailChallenge] = useState<string | null>(null);
  const [emailBusy, setEmailBusy] = useState(false);
  const [emailError, setEmailError] = useState<string | null>(null);

  const [background, setBackground] = useState<TraineeBackground>({
    education_level: "",
    institution_name: "",
    field_of_study: "",
    education_status: "",
    education_year: null,
  });
  const [confirmClose, setConfirmClose] = useState(false);

  // Deep links, both ways: read the hash on arrival, and keep it in step when
  // a tab is chosen so the address bar can be shared or reloaded.
  useEffect(() => {
    const apply = () => {
      const wanted = tabFromHash();
      if (wanted) setTab(wanted);
    };
    apply();
    window.addEventListener("hashchange", apply);
    return () => window.removeEventListener("hashchange", apply);
  }, []);

  function goTo(next: TraineeTab) {
    setTab(next);
    if (typeof window !== "undefined") {
      window.history.replaceState(null, "", `#${next}`);
    }
  }

  useEffect(() => {
    let active = true;
    getTraineeSession()
      .then(async (current) => {
        if (!current.authenticated) {
          router.replace("/trainee/sign-in");
          return;
        }
        const [nextEnquiries, nextEnrolments, nextSaved] = await Promise.all([
          getTraineeEnquiries(),
          getTraineeEnrolments(),
          getSavedProviders(),
        ]);
        if (!active) return;
        setSession(current);
        setName(current.account.display_name);
        setChannel(current.account.preferred_channel);
        setBackground({
          education_level: current.account.education_level,
          institution_name: current.account.institution_name,
          field_of_study: current.account.field_of_study,
          education_status: current.account.education_status,
          education_year: current.account.education_year,
        });
        setEnquiries(nextEnquiries);
        setEnrolments(nextEnrolments);
        setSaved(nextSaved);
      })
      .catch((reason) => {
        if (active) setError(reason instanceof Error ? reason.message : "Could not load your account.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [router]);

  const readOnly = Boolean(session?.support && !session.support.can_edit);

  async function run(task: () => Promise<void>) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await task();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Something went wrong. Try again.");
    } finally {
      setBusy(false);
    }
  }

  const signOut = () =>
    run(async () => {
      const result = await logoutTrainee();
      if (session?.support) {
        // The back office is a Django page, not a Next.js route.
        const target = new URL(
          result.back_office_url ?? "/back-office/",
          // The back office is on Django: same origin in production, the API
          // dev server in development.
          browserApiUrl() || window.location.origin,
        );
        window.location.href = target.toString();
        return;
      }
      router.replace("/");
    });

  const unsave = (providerId: number) =>
    run(async () => {
      await removeSavedProvider(providerId);
      setSaved((items) => items.filter((item) => item.provider.id !== providerId));
    });

  const saveSettings = (event: React.FormEvent) => {
    event.preventDefault();
    return run(async () => {
      const account = await updateTraineeAccount({
        display_name: name.trim(),
        preferred_channel: channel,
        ...background,
        institution_name: background.institution_name.trim(),
        field_of_study: background.field_of_study.trim(),
      });
      setSession((current) => (current ? {...current, account} : current));
      setNotice("Saved.");
    });
  };

  async function sendEmailCode(event: React.FormEvent) {
    event.preventDefault();
    const address = emailDraft.trim();
    if (!address.includes("@")) {
      setEmailError("Enter your email address.");
      return;
    }
    setEmailBusy(true);
    setEmailError(null);
    try {
      const challenge = await requestAddEmailCode(address);
      setEmailChallenge(challenge.challenge_id);
      setEmailCode("");
    } catch (reason) {
      setEmailError(reason instanceof Error ? reason.message : "Could not send a code.");
    } finally {
      setEmailBusy(false);
    }
  }

  async function confirmEmail(event: React.FormEvent) {
    event.preventDefault();
    if (!emailChallenge) return;
    setEmailBusy(true);
    setEmailError(null);
    try {
      const account = await confirmAddEmail(emailChallenge, emailDraft.trim(), emailCode);
      setSession((current) => (current ? {...current, account} : current));
      setEmailChallenge(null);
      setEmailDraft("");
      setEmailCode("");
      setNotice("Email added. You can sign in with it now.");
    } catch (reason) {
      setEmailError(reason instanceof Error ? reason.message : "That code did not work.");
    } finally {
      setEmailBusy(false);
    }
  }

  const closeAccount = () =>
    run(async () => {
      await closeTraineeAccount();
      router.replace("/");
    });

  if (loading) {
    return (
      <div role="status" aria-busy="true" className="space-y-4">
        <span className="sr-only">Loading your account…</span>
        <Skeleton className="h-24 w-full rounded-2xl" />
        <Skeleton className="h-12 w-full rounded-xl" />
        <Skeleton className="h-40 w-full rounded-2xl" />
      </div>
    );
  }

  if (!session) {
    return (
      <Card role="alert" className="border-[var(--color-warn)]/20 p-6">
        <div className="flex items-start gap-3">
          <AlertCircle aria-hidden="true" className="size-5 text-[var(--color-warn)]" />
          <div>
            <p className="font-semibold">Your account could not be loaded</p>
            <p className="mt-1 text-sm text-[var(--color-muted-foreground)]">{error}</p>
            <Button type="button" variant="outline" className="mt-4" onClick={() => window.location.reload()}>
              Try again
            </Button>
          </div>
        </div>
      </Card>
    );
  }

  // The phone is the account, so it is what we have before someone types a
  // name. Greeting a person by their own phone number reads like a receipt,
  // so the number moves to the line below and the greeting stays warm.
  const named = Boolean(session.account.display_name.trim());
  const greeting = named ? session.account.display_name : "there";
  const counts = {
    enquiries: awaitingReply(enquiries),
    saved: saved.length,
  };

  const visibleEnquiries = enquiries.filter(
    (enquiry) =>
      (statusFilter === "all" || enquiry.status === statusFilter) &&
      matchesQuery(enquiryQuery, enquiry.provider.name, enquiry.programme_title, enquiry.reference_code),
  );
  const visibleSaved = saved.filter((item) =>
    matchesQuery(savedQuery, item.provider.name, item.provider.area),
  );
  const clearEnquiryFilters = () => {
    setStatusFilter("all");
    setEnquiryQuery("");
  };

  const enquiryControls = (
    <div className="space-y-3">
      <SearchBox
        value={enquiryQuery}
        onChange={setEnquiryQuery}
        label="Search your enquiries"
        placeholder="Search by workshop, course or reference"
      />
      {/* Horizontal scroll rather than a wrap: six chips wrapping to three
          rows pushes the first card off a phone screen. */}
      <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1" role="group" aria-label="Filter by status">
        {FILTERS.map(({key, label}) => {
          const active = statusFilter === key;
          const n = key === "all" ? enquiries.length : enquiries.filter((e) => e.status === key).length;
          return (
            <button
              key={key}
              type="button"
              onClick={() => setStatusFilter(key)}
              aria-pressed={active}
              className={cn(
                "shrink-0 rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors",
                active
                  ? "border-transparent bg-[var(--color-brand)] text-white"
                  : "border-[var(--color-border)] bg-[var(--color-card)] text-[var(--color-muted-foreground)] hover:border-[var(--color-border-strong)]",
              )}
            >
              {label}
              <span className="ml-1.5 tabular-nums opacity-70">{n}</span>
            </button>
          );
        })}
      </div>
    </div>
  );

  const identity = (
    <div className="flex items-center gap-3 rounded-2xl border border-[var(--color-border)] bg-[var(--color-card)] p-4 shadow-[var(--shadow-card)]">
      <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-[var(--color-brand-soft)] text-[var(--color-brand-strong)]">
        <UserRound aria-hidden="true" className="size-5" />
      </span>
      <div className="min-w-0">
        <p className="truncate text-sm font-bold leading-5">
          {named ? session.account.display_name : "Your account"}
        </p>
        <p className="truncate text-xs text-[var(--color-muted-foreground)]">{session.account.phone}</p>
      </div>
    </div>
  );

  return (
    /* pb-20 on a phone clears the fixed bottom bar; the sidebar replaces it
       from lg up, where the padding is no longer needed. */
    <div data-trainee-dashboard className="pb-20 lg:pb-0">
      {session.support ? <SupportBanner support={session.support} onLeave={signOut} busy={busy} /> : null}

      <header className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--color-brand-strong)]">
            Your account
          </p>
          <h1 className="truncate text-2xl font-bold tracking-[-0.03em] sm:text-3xl">Hello, {greeting}</h1>
          <p className="mt-1 text-sm text-[var(--color-muted-foreground)]">
            {enquiries.length} {enquiries.length === 1 ? "enquiry" : "enquiries"} · {enrolments.length}{" "}
            {enrolments.length === 1 ? "course" : "courses"} · {saved.length} saved
          </p>
        </div>
        {session.support ? null : (
          <Button type="button" variant="outline" onClick={signOut} disabled={busy} className="lg:hidden">
            <LogOut aria-hidden="true" />
            Sign out
          </Button>
        )}
      </header>

      <div className="gap-7 lg:grid lg:grid-cols-[15rem_minmax(0,1fr)]">
        <TraineeSidebar
          tab={tab}
          onSelect={goTo}
          counts={counts}
          onSignOut={signOut}
          busy={busy}
          canSignOut={!session.support}
        >
          {identity}
        </TraineeSidebar>

        <div className="min-w-0">
      {error ? (
        <p role="alert" className="mb-4 rounded-xl bg-[var(--color-warn-bg)] p-3 text-sm text-[var(--color-warn)]">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p role="status" className="mb-4 rounded-xl bg-[var(--color-visit-bg)] p-3 text-sm text-[var(--color-visit)]">
          {notice}
        </p>
      ) : null}

      {tab === "overview" ? (
        <TraineeOverview
          account={session.account}
          enquiries={enquiries}
          enrolments={enrolments}
          saved={saved}
          onGo={goTo}
        />
      ) : null}

      {tab === "enquiries" ? (
        enquiries.length === 0 ? (
          <Empty
            title="No enquiries yet"
            text="When you enquire with a workshop using this number, it appears here with its reference."
          />
        ) : visibleEnquiries.length === 0 ? (
          <div className="space-y-4">
            {enquiryControls}
            <NoMatches onClear={clearEnquiryFilters} />
          </div>
        ) : (
          <div className="space-y-4">
            {enquiryControls}
          <ul className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
            {visibleEnquiries.map((enquiry) => (
              <li key={enquiry.reference_code}>
                <Card className="h-full">
                  <CardHeader className="pb-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <Badge variant={STATUS[enquiry.status].variant}>{STATUS[enquiry.status].label}</Badge>
                      <span className="font-mono text-xs text-[var(--color-muted-foreground)]">
                        {enquiry.reference_code}
                      </span>
                    </div>
                    <CardTitle className="text-lg">
                      <ProviderName provider={enquiry.provider} />
                    </CardTitle>
                    <CardDescription>
                      {enquiry.programme_title || "Training enquiry"}
                      {enquiry.intake_start ? ` · starts ${formatDate(enquiry.intake_start)}` : ""}
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3 text-sm">
                    {enquiry.message ? (
                      <p className="rounded-xl bg-[var(--color-muted)]/70 p-3 leading-6">“{enquiry.message}”</p>
                    ) : null}
                    <p className="flex items-center gap-2 text-[var(--color-muted-foreground)]">
                      <CalendarDays aria-hidden="true" className="size-4" />
                      Sent {formatDate(enquiry.created_at)}
                    </p>
                    <Button asChild variant="brand" className="w-full">
                      <a href={enquiry.whatsapp_url} target="_blank" rel="noopener noreferrer">
                        <MessageCircle aria-hidden="true" />
                        Continue on WhatsApp
                      </a>
                    </Button>
                  </CardContent>
                </Card>
              </li>
            ))}
          </ul>
          </div>
        )
      ) : null}

      {tab === "training" ? (
        enrolments.length === 0 ? (
          <Empty
            title="No training recorded yet"
            text="When a workshop tells us you started a course, it shows here."
          />
        ) : (
          <ul className="grid gap-4 md:grid-cols-2">
            {enrolments.map((enrolment) => (
              <li key={enrolment.id}>
                <Card className="h-full p-5">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-semibold">{enrolment.programme_title}</p>
                      <p className="text-sm text-[var(--color-muted-foreground)]">
                        <ProviderName provider={enrolment.provider} />
                      </p>
                    </div>
                    {enrolment.completed_on ? (
                      <Badge>
                        <CheckCircle2 aria-hidden="true" />
                        Completed
                      </Badge>
                    ) : (
                      <Badge variant="secondary">In training</Badge>
                    )}
                  </div>
                  <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
                    <div>
                      <dt className="text-[var(--color-muted-foreground)]">Started</dt>
                      <dd className="font-semibold">{formatDate(enrolment.started_on)}</dd>
                    </div>
                    <div>
                      <dt className="text-[var(--color-muted-foreground)]">
                        {enrolment.completed_on ? "Finished" : "Fee paid"}
                      </dt>
                      <dd className="font-semibold">
                        {enrolment.completed_on
                          ? formatDate(enrolment.completed_on)
                          : enrolment.fee_paid
                            ? formatFee(enrolment.fee_paid)
                            : "Not recorded"}
                      </dd>
                    </div>
                  </dl>
                </Card>
              </li>
            ))}
          </ul>
        )
      ) : null}

      {tab === "saved" ? (
        saved.length === 0 ? (
          <Empty title="Nothing saved yet" text="Use Save on a workshop page to keep it here for later." />
        ) : (
          <div className="space-y-4">
            <SearchBox
              value={savedQuery}
              onChange={setSavedQuery}
              label="Search saved workshops"
              placeholder="Search by name or area"
            />
            {visibleSaved.length === 0 ? <NoMatches onClear={() => setSavedQuery("")} /> : null}
          <ul className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
            {visibleSaved.map((item) => (
              <li key={item.provider.id}>
                <Card className="flex-row items-center justify-between gap-3 p-4">
                  <div className="min-w-0">
                    <p className="truncate font-semibold">
                      <ProviderName provider={item.provider} />
                    </p>
                    <p className="text-sm text-[var(--color-muted-foreground)]">{item.provider.area}</p>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => unsave(item.provider.id)}
                    disabled={busy || readOnly}
                    aria-label={`Remove ${item.provider.name} from saved`}
                  >
                    <Trash2 aria-hidden="true" />
                  </Button>
                </Card>
              </li>
            ))}
          </ul>
          </div>
        )
      ) : null}

      {tab === "settings" ? (
        <div className="grid gap-5 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Your details</CardTitle>
              <CardDescription>
                Signed in as {session.account.phone}. The phone number is your account and cannot be changed here.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={saveSettings} className="space-y-4">
                <fieldset disabled={busy || readOnly} className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="trainee-name">Your name (optional)</Label>
                    <Input
                      id="trainee-name"
                      value={name}
                      maxLength={120}
                      onChange={(event) => setName(event.target.value)}
                      placeholder="How workshops should address you"
                    />
                  </div>
                  <div className="space-y-2">
                    <p className="text-sm font-medium">Where should we reach you?</p>
                    {(["whatsapp", "telegram"] as const).map((option) => (
                      <label
                        key={option}
                        className="flex min-h-11 cursor-pointer items-center gap-3 rounded-xl border border-[var(--color-border)] px-3"
                      >
                        <input
                          type="radio"
                          name="channel"
                          value={option}
                          checked={channel === option}
                          onChange={() => setChannel(option)}
                        />
                        {option === "whatsapp" ? "WhatsApp" : "Telegram"}
                      </label>
                    ))}
                  </div>
                  <div className="space-y-4 rounded-2xl border border-[var(--color-border)] p-4">
                    <div>
                      <p className="text-sm font-semibold">Your background</p>
                      <p className="mt-1 text-xs leading-5 text-[var(--color-muted-foreground)]">
                        All optional, and it never affects what you can see. It helps us
                        suggest training that suits where you are coming from.
                      </p>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="trainee-education">Where are you coming from?</Label>
                      <NativeSelect
                        id="trainee-education"
                        value={background.education_level}
                        onChange={(event) =>
                          setBackground((current) => ({
                            ...current,
                            education_level: event.target
                              .value as TraineeBackground["education_level"],
                          }))
                        }
                      >
                        <option value="">Prefer not to say</option>
                        <option value="university">University or other tertiary</option>
                        <option value="tvet">CTVET or other TVET institution</option>
                        <option value="shs_technical">SHS — technical or vocational</option>
                        <option value="shs_general">SHS — general</option>
                        <option value="jhs">JHS</option>
                        <option value="not_in_school">Not in school</option>
                        <option value="other">Something else</option>
                      </NativeSelect>
                    </div>

                    {/* The rest only matters once a school has been named, and
                        hiding it keeps the default form short on a phone. */}
                    {background.education_level &&
                    background.education_level !== "not_in_school" ? (
                      <>
                        <div className="space-y-2">
                          <Label htmlFor="trainee-institution">Which school?</Label>
                          <Input
                            id="trainee-institution"
                            value={background.institution_name}
                            maxLength={200}
                            onChange={(event) =>
                              setBackground((current) => ({
                                ...current,
                                institution_name: event.target.value,
                              }))
                            }
                            placeholder="For example: Accra Technical Training Centre"
                          />
                        </div>

                        <div className="space-y-2">
                          <Label htmlFor="trainee-subject">What did you study?</Label>
                          <Input
                            id="trainee-subject"
                            value={background.field_of_study}
                            maxLength={200}
                            onChange={(event) =>
                              setBackground((current) => ({
                                ...current,
                                field_of_study: event.target.value,
                              }))
                            }
                            placeholder="For example: building construction"
                          />
                        </div>

                        <div className="grid gap-4 sm:grid-cols-2">
                          <div className="space-y-2">
                            <Label htmlFor="trainee-education-status">How far did you get?</Label>
                            <NativeSelect
                              id="trainee-education-status"
                              value={background.education_status}
                              onChange={(event) =>
                                setBackground((current) => ({
                                  ...current,
                                  education_status: event.target
                                    .value as TraineeBackground["education_status"],
                                }))
                              }
                            >
                              <option value="">Prefer not to say</option>
                              <option value="in_progress">Still studying</option>
                              <option value="completed">Completed</option>
                              <option value="left">Left before finishing</option>
                            </NativeSelect>
                          </div>

                          <div className="space-y-2">
                            <Label htmlFor="trainee-education-year">Which year?</Label>
                            <Input
                              id="trainee-education-year"
                              type="number"
                              inputMode="numeric"
                              min={1950}
                              max={2100}
                              value={background.education_year ?? ""}
                              onChange={(event) =>
                                setBackground((current) => ({
                                  ...current,
                                  // Empty clears it rather than sending NaN,
                                  // which the API would refuse.
                                  education_year: event.target.value
                                    ? Number(event.target.value)
                                    : null,
                                }))
                              }
                              placeholder="2024"
                            />
                          </div>
                        </div>
                      </>
                    ) : null}
                  </div>

                  <Button type="submit" variant="brand">
                    {busy ? <Loader2 aria-hidden="true" className="animate-spin" /> : null}
                    Save
                  </Button>
                </fieldset>
                {readOnly ? (
                  <p className="text-xs text-[var(--color-muted-foreground)]">Support view is read-only.</p>
                ) : null}
              </form>

              {/* Adding an address is deliberately outside the settings form.
                  An address is claimed by proving it with a code, not by
                  typing it into a field the server takes on trust — so it
                  cannot share a Save button with the name and the channel. */}
              <div className="mt-6 space-y-3 border-t border-[var(--color-border)] pt-5">
                <div>
                  <p className="text-sm font-semibold">Signing in with email</p>
                  <p className="mt-1 text-xs leading-5 text-[var(--color-muted-foreground)]">
                    Your phone number stays how workshops reach you. An email is a second
                    way to sign in, useful when text messages do not arrive.
                  </p>
                </div>

                {session.account.email ? (
                  <p className="flex items-center gap-2 rounded-xl bg-[var(--color-muted)]/65 p-3 text-sm">
                    <MailCheck aria-hidden="true" className="size-4 shrink-0 text-[var(--color-visit)]" />
                    <span>
                      <strong>{session.account.email}</strong> is on your account.
                    </span>
                  </p>
                ) : emailChallenge ? (
                  <form onSubmit={confirmEmail} className="space-y-2">
                    <Label htmlFor="trainee-email-code">
                      Code sent to {emailDraft.trim()}
                    </Label>
                    <Input
                      id="trainee-email-code"
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      maxLength={8}
                      value={emailCode}
                      onChange={(event) => setEmailCode(event.target.value.replace(/\D/g, ""))}
                      className="text-center text-lg font-semibold tabular-nums tracking-[0.3em]"
                      autoFocus
                    />
                    {emailError ? (
                      <p role="alert" className="text-sm text-[var(--color-destructive)]">
                        {emailError}
                      </p>
                    ) : null}
                    <div className="flex flex-wrap gap-2">
                      <Button type="submit" variant="brand" disabled={emailBusy}>
                        {emailBusy ? (
                          <Loader2 aria-hidden="true" className="animate-spin" />
                        ) : null}
                        Confirm email
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        onClick={() => {
                          setEmailChallenge(null);
                          setEmailError(null);
                        }}
                      >
                        Use a different address
                      </Button>
                    </div>
                  </form>
                ) : (
                  <form onSubmit={sendEmailCode} className="space-y-2">
                    <fieldset disabled={readOnly} className="space-y-2">
                      <Label htmlFor="trainee-new-email">Email address</Label>
                      <Input
                        id="trainee-new-email"
                        type="email"
                        inputMode="email"
                        autoComplete="email"
                        placeholder="you@example.com"
                        value={emailDraft}
                        onChange={(event) => setEmailDraft(event.target.value)}
                      />
                      {emailError ? (
                        <p role="alert" className="text-sm text-[var(--color-destructive)]">
                          {emailError}
                        </p>
                      ) : null}
                      <Button type="submit" variant="outline" disabled={emailBusy}>
                        {emailBusy ? (
                          <Loader2 aria-hidden="true" className="animate-spin" />
                        ) : (
                          <Mail aria-hidden="true" />
                        )}
                        Send me a code
                      </Button>
                    </fieldset>
                  </form>
                )}
              </div>
            </CardContent>
          </Card>

          {session.support ? null : (
            <Card className="border-[var(--color-destructive)]/20">
              <CardHeader>
                <CardTitle>Close your account</CardTitle>
                <CardDescription>
                  Your sign-in and saved list are deleted. Enquiries you sent stay with the workshops you sent them to.
                </CardDescription>
              </CardHeader>
              <CardContent>
                {confirmClose ? (
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <Button type="button" variant="destructive" onClick={closeAccount} disabled={busy}>
                      Yes, close my account
                    </Button>
                    <Button type="button" variant="ghost" onClick={() => setConfirmClose(false)}>
                      Keep it
                    </Button>
                  </div>
                ) : (
                  <Button type="button" variant="outline" onClick={() => setConfirmClose(true)}>
                    Close account
                  </Button>
                )}
              </CardContent>
            </Card>
          )}
        </div>
      ) : null}
        </div>
      </div>

      <TraineeBottomBar tab={tab} onSelect={goTo} counts={counts} />
    </div>
  );
}
