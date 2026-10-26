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
import {useTranslations} from "next-intl";
import {useEffect, useState} from "react";

import {DashboardBottomBar, DashboardSidebar} from "@/components/dashboard/DashboardNav";
import type {TraineeTab} from "@/components/trainee/TraineeNav";
import {useTraineeTabs} from "@/components/trainee/TraineeNav";
import {EDUCATION_STATUSES} from "@/components/trainee/TraineeSignIn";
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
  removeTraineeAvatar,
  requestAddEmailCode,
  updateTraineeAccount,
  uploadTraineeAvatar,
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

/** How each status is drawn. Its words are in the "TraineeDashboard.status"
 *  messages. */
const STATUS_VARIANT: Record<TraineeEnquiryStatus, "secondary" | "warning" | "default"> = {
  sent: "secondary",
  replied: "default",
  visited: "default",
  enrolled: "default",
  not_delivered: "warning",
};

/** Short enough to sit in a row of chips on a phone; words in "filters". */
const FILTERS: ReadonlyArray<TraineeEnquiryStatus | "all"> = [
  "all",
  "sent",
  "replied",
  "visited",
  "enrolled",
  "not_delivered",
];

/** Settings lists schooling from the furthest stage down; sign-up from the
 *  first stage up. Labels are shared, in the "Education" messages. */
const SETTINGS_EDUCATION_ORDER = [
  "university",
  "tvet",
  "shs_technical",
  "shs_general",
  "jhs",
  "not_in_school",
  "other",
] as const;

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
  const t = useTranslations("TraineeDashboard");
  return (
    <Card className="border-dashed p-6 text-center">
      <MessageSquareOff aria-hidden="true" className="mx-auto size-5 text-[var(--color-muted-foreground)]" />
      <p className="mt-3 font-semibold">{t("noMatchesTitle")}</p>
      <p className="mt-1 text-sm text-[var(--color-muted-foreground)]">{t("noMatchesBody")}</p>
      <Button type="button" variant="outline" className="mx-auto mt-4" onClick={onClear}>
        {t("clearFilters")}
      </Button>
    </Card>
  );
}


function ProviderName({provider}: {provider: TraineeProviderLink}) {
  const t = useTranslations("TraineeDashboard");
  if (!provider.is_listed) {
    return (
      <span>
        {provider.name}{" "}
        <span className="font-normal text-[var(--color-muted-foreground)]">{t("noLongerListed")}</span>
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
  const t = useTranslations("TraineeDashboard");
  return (
    <Card className="border-dashed p-6 text-center">
      <p className="font-semibold">{title}</p>
      <p className="mt-1 text-sm text-[var(--color-muted-foreground)]">{text}</p>
      <Button asChild variant="outline" className="mx-auto mt-4">
        <Link href="/training">
          {t("findTraining")}
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
  const t = useTranslations("TraineeDashboard");
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
            {support.can_edit
              ? t("supportEditing", {staff: support.staff_name})
              : t("supportViewing", {staff: support.staff_name})}
          </p>
          <p className="text-[var(--color-muted-foreground)]">
            {t("supportDetail", {reason: support.reason, ends})}
          </p>
        </div>
      </div>
      <Button type="button" variant="outline" onClick={onLeave} disabled={busy} className="shrink-0">
        {busy ? <Loader2 aria-hidden="true" className="animate-spin" /> : <LogOut aria-hidden="true" />}
        {t("leaveSupport")}
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
  const t = useTranslations("TraineeDashboard");
  const tEducation = useTranslations("Education");
  const tFormat = useTranslations("Format");
  const tabs = useTraineeTabs();
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
  const [photoBusy, setPhotoBusy] = useState(false);

  async function changePhoto(file: File | null) {
    if (!file) return;
    // Checked here as well as on the server so somebody on a slow connection
    // is told before they spend the upload rather than after it.
    if (file.size > 15 * 1024 * 1024) {
      setError(t("photoTooLarge"));
      return;
    }
    setPhotoBusy(true);
    setError(null);
    setNotice(null);
    try {
      const next = await uploadTraineeAvatar(file);
      if (next.authenticated) setSession(next);
      setNotice(t("photoUpdated"));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t("photoSaveFailed"));
    } finally {
      setPhotoBusy(false);
    }
  }

  async function dropPhoto() {
    setPhotoBusy(true);
    setError(null);
    setNotice(null);
    try {
      const next = await removeTraineeAvatar();
      if (next.authenticated) setSession(next);
      setNotice(t("photoRemoved"));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t("photoRemoveFailed"));
    } finally {
      setPhotoBusy(false);
    }
  }

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
        if (active) setError(reason instanceof Error ? reason.message : t("loadFailed"));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [router, t]);

  const readOnly = Boolean(session?.support && !session.support.can_edit);

  async function run(task: () => Promise<void>) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await task();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t("genericError"));
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
      setNotice(t("saved"));
    });
  };

  async function sendEmailCode(event: React.FormEvent) {
    event.preventDefault();
    const address = emailDraft.trim();
    if (!address.includes("@")) {
      setEmailError(t("enterEmail"));
      return;
    }
    setEmailBusy(true);
    setEmailError(null);
    try {
      const challenge = await requestAddEmailCode(address);
      setEmailChallenge(challenge.challenge_id);
      setEmailCode("");
    } catch (reason) {
      setEmailError(reason instanceof Error ? reason.message : t("codeSendFailed"));
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
      setNotice(t("emailAdded"));
    } catch (reason) {
      setEmailError(reason instanceof Error ? reason.message : t("codeFailed"));
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
        <span className="sr-only">{t("loading")}</span>
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
            <p className="font-semibold">{t("loadFailedTitle")}</p>
            <p className="mt-1 text-sm text-[var(--color-muted-foreground)]">{error}</p>
            <Button type="button" variant="outline" className="mt-4" onClick={() => window.location.reload()}>
              {t("tryAgain")}
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
        label={t("searchEnquiriesLabel")}
        placeholder={t("searchEnquiriesPlaceholder")}
      />
      {/* Horizontal scroll rather than a wrap: six chips wrapping to three
          rows pushes the first card off a phone screen. */}
      <div
        className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1"
        role="group"
        aria-label={t("filterByStatus")}
      >
        {FILTERS.map((key) => {
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
              {t(`filters.${key}`)}
              <span className="ml-1.5 tabular-nums opacity-70">{n}</span>
            </button>
          );
        })}
      </div>
    </div>
  );

  const identity = (
    <div className="flex items-center gap-3 rounded-2xl border border-[var(--color-border)] bg-[var(--color-card)] p-4 shadow-[var(--shadow-card)]">
      {session.account.avatar ? (
        /* A plain img, not next/image: it is 44px, so there is nothing for the
           optimiser to save, and one fewer round trip on a slow connection. */
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={session.account.avatar}
          alt=""
          className="size-11 shrink-0 rounded-xl object-cover"
        />
      ) : (
        <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-[var(--color-brand-soft)] text-[var(--color-brand-strong)]">
          <UserRound aria-hidden="true" className="size-5" />
        </span>
      )}
      <div className="min-w-0">
        <p className="truncate text-sm font-bold leading-5">
          {named ? session.account.display_name : t("yourAccount")}
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
            {t("yourAccount")}
          </p>
          <h1 className="truncate text-2xl font-bold tracking-[-0.03em] sm:text-3xl">
            {named ? t("helloName", {name: session.account.display_name}) : t("helloThere")}
          </h1>
          <p className="mt-1 text-sm text-[var(--color-muted-foreground)]">
            {t("summary", {
              enquiries: enquiries.length,
              courses: enrolments.length,
              saved: saved.length,
            })}
          </p>
        </div>
        {session.support ? null : (
          <Button type="button" variant="outline" onClick={signOut} disabled={busy} className="lg:hidden">
            <LogOut aria-hidden="true" />
            {t("signOut")}
          </Button>
        )}
      </header>

      <div className="gap-7 lg:grid lg:grid-cols-[15rem_minmax(0,1fr)]">
        <DashboardSidebar
          tabs={tabs}
          tab={tab}
          onSelect={goTo}
          counts={counts}
          onSignOut={signOut}
          busy={busy}
          canSignOut={!session.support}
        >
          {identity}
        </DashboardSidebar>

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
          <Empty title={t("noEnquiriesTitle")} text={t("noEnquiriesBody")} />
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
                      <Badge variant={STATUS_VARIANT[enquiry.status]}>
                        {t(`status.${enquiry.status}`)}
                      </Badge>
                      <span className="font-mono text-xs text-[var(--color-muted-foreground)]">
                        {enquiry.reference_code}
                      </span>
                    </div>
                    <CardTitle className="text-lg">
                      <ProviderName provider={enquiry.provider} />
                    </CardTitle>
                    <CardDescription>
                      {enquiry.programme_title || t("trainingEnquiry")}
                      {enquiry.intake_start
                        ? ` · ${t("starts", {date: formatDate(enquiry.intake_start)})}`
                        : ""}
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3 text-sm">
                    {enquiry.message ? (
                      <p className="rounded-xl bg-[var(--color-muted)]/70 p-3 leading-6">“{enquiry.message}”</p>
                    ) : null}
                    <p className="flex items-center gap-2 text-[var(--color-muted-foreground)]">
                      <CalendarDays aria-hidden="true" className="size-4" />
                      {t("sentOn", {date: formatDate(enquiry.created_at)})}
                    </p>
                    <Button asChild variant="brand" className="w-full">
                      <a href={enquiry.whatsapp_url} target="_blank" rel="noopener noreferrer">
                        <MessageCircle aria-hidden="true" />
                        {t("continueWhatsApp")}
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
          <Empty title={t("noTrainingTitle")} text={t("noTrainingBody")} />
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
                        {t("completed")}
                      </Badge>
                    ) : (
                      <Badge variant="secondary">{t("inTraining")}</Badge>
                    )}
                  </div>
                  <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
                    <div>
                      <dt className="text-[var(--color-muted-foreground)]">{t("started")}</dt>
                      <dd className="font-semibold">{formatDate(enrolment.started_on)}</dd>
                    </div>
                    <div>
                      <dt className="text-[var(--color-muted-foreground)]">
                        {enrolment.completed_on ? t("finished") : t("feePaid")}
                      </dt>
                      <dd className="font-semibold">
                        {enrolment.completed_on
                          ? formatDate(enrolment.completed_on)
                          : enrolment.fee_paid
                            ? formatFee(enrolment.fee_paid, tFormat)
                            : t("notRecorded")}
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
          <Empty title={t("noSavedTitle")} text={t("noSavedBody")} />
        ) : (
          <div className="space-y-4">
            <SearchBox
              value={savedQuery}
              onChange={setSavedQuery}
              label={t("searchSavedLabel")}
              placeholder={t("searchSavedPlaceholder")}
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
                    aria-label={t("removeSaved", {name: item.provider.name})}
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
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle>{t("pictureTitle")}</CardTitle>
              <CardDescription>{t("pictureBody")}</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap items-center gap-4">
                {session.account.avatar ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={session.account.avatar}
                    alt=""
                    className="size-20 shrink-0 rounded-full object-cover"
                  />
                ) : (
                  <span className="grid size-20 shrink-0 place-items-center rounded-full bg-[var(--color-muted)] text-[var(--color-muted-foreground)]">
                    <UserRound aria-hidden="true" className="size-8" />
                  </span>
                )}
                <div className="min-w-0 flex-1 space-y-2">
                  <Label htmlFor="trainee-avatar">
                    {session.account.avatar ? t("choosePicture") : t("addPicture")}
                  </Label>
                  <Input
                    id="trainee-avatar"
                    type="file"
                    accept="image/*"
                    disabled={photoBusy || readOnly}
                    onChange={(event) => changePhoto(event.target.files?.[0] ?? null)}
                  />
                  {session.account.avatar ? (
                    <Button
                      type="button"
                      variant="ghost"
                      disabled={photoBusy || readOnly}
                      onClick={dropPhoto}
                    >
                      {photoBusy ? (
                        <Loader2 aria-hidden="true" className="animate-spin" />
                      ) : (
                        <Trash2 aria-hidden="true" />
                      )}
                      {t("removePicture")}
                    </Button>
                  ) : null}
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{t("detailsTitle")}</CardTitle>
              <CardDescription>{t("detailsBody", {phone: session.account.phone})}</CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={saveSettings} className="space-y-4">
                <fieldset disabled={busy || readOnly} className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="trainee-name">{t("nameLabel")}</Label>
                    <Input
                      id="trainee-name"
                      value={name}
                      maxLength={120}
                      onChange={(event) => setName(event.target.value)}
                      placeholder={t("namePlaceholder")}
                    />
                  </div>
                  <div className="space-y-2">
                    <p className="text-sm font-medium">{t("channelQuestion")}</p>
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
                        {t(`channels.${option}`)}
                      </label>
                    ))}
                  </div>
                  <div className="space-y-4 rounded-2xl border border-[var(--color-border)] p-4">
                    <div>
                      <p className="text-sm font-semibold">{t("backgroundTitle")}</p>
                      <p className="mt-1 text-xs leading-5 text-[var(--color-muted-foreground)]">
                        {t("backgroundBody")}
                      </p>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="trainee-education">{t("educationLabel")}</Label>
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
                        <option value="">{tEducation("preferNotToSay")}</option>
                        {SETTINGS_EDUCATION_ORDER.map((value) => (
                          <option key={value} value={value}>
                            {tEducation(`levels.${value}`)}
                          </option>
                        ))}
                      </NativeSelect>
                    </div>

                    {/* The rest only matters once a school has been named, and
                        hiding it keeps the default form short on a phone. */}
                    {background.education_level &&
                    background.education_level !== "not_in_school" ? (
                      <>
                        <div className="space-y-2">
                          <Label htmlFor="trainee-institution">{t("institutionLabel")}</Label>
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
                            placeholder={t("institutionPlaceholder")}
                          />
                        </div>

                        <div className="space-y-2">
                          <Label htmlFor="trainee-subject">{t("subjectLabel")}</Label>
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
                            placeholder={t("subjectPlaceholder")}
                          />
                        </div>

                        <div className="grid gap-4 sm:grid-cols-2">
                          <div className="space-y-2">
                            <Label htmlFor="trainee-education-status">{t("statusLabel")}</Label>
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
                              <option value="">{tEducation("preferNotToSay")}</option>
                              {EDUCATION_STATUSES.map((value) => (
                                <option key={value} value={value}>
                                  {tEducation(`statuses.${value}`)}
                                </option>
                              ))}
                            </NativeSelect>
                          </div>

                          <div className="space-y-2">
                            <Label htmlFor="trainee-education-year">{t("yearLabel")}</Label>
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
                    {t("save")}
                  </Button>
                </fieldset>
                {readOnly ? (
                  <p className="text-xs text-[var(--color-muted-foreground)]">{t("supportReadOnly")}</p>
                ) : null}
              </form>

              {/* Adding an address is deliberately outside the settings form.
                  An address is claimed by proving it with a code, not by
                  typing it into a field the server takes on trust — so it
                  cannot share a Save button with the name and the channel. */}
              <div className="mt-6 space-y-3 border-t border-[var(--color-border)] pt-5">
                <div>
                  <p className="text-sm font-semibold">{t("emailSignInTitle")}</p>
                  <p className="mt-1 text-xs leading-5 text-[var(--color-muted-foreground)]">
                    {t("emailSignInBody")}
                  </p>
                </div>

                {session.account.email ? (
                  <p className="flex items-center gap-2 rounded-xl bg-[var(--color-muted)]/65 p-3 text-sm">
                    <MailCheck aria-hidden="true" className="size-4 shrink-0 text-[var(--color-visit)]" />
                    <span>
                      {t.rich("emailOnAccount", {
                        email: session.account.email,
                        strong: (chunks) => <strong>{chunks}</strong>,
                      })}
                    </span>
                  </p>
                ) : emailChallenge ? (
                  <form onSubmit={confirmEmail} className="space-y-2">
                    <Label htmlFor="trainee-email-code">
                      {t("codeSentTo", {email: emailDraft.trim()})}
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
                        {t("confirmEmail")}
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        onClick={() => {
                          setEmailChallenge(null);
                          setEmailError(null);
                        }}
                      >
                        {t("differentAddress")}
                      </Button>
                    </div>
                  </form>
                ) : (
                  <form onSubmit={sendEmailCode} className="space-y-2">
                    <fieldset disabled={readOnly} className="space-y-2">
                      <Label htmlFor="trainee-new-email">{t("emailLabel")}</Label>
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
                        {t("sendCode")}
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
                <CardTitle>{t("closeTitle")}</CardTitle>
                <CardDescription>{t("closeBody")}</CardDescription>
              </CardHeader>
              <CardContent>
                {confirmClose ? (
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <Button type="button" variant="destructive" onClick={closeAccount} disabled={busy}>
                      {t("closeConfirm")}
                    </Button>
                    <Button type="button" variant="ghost" onClick={() => setConfirmClose(false)}>
                      {t("closeKeep")}
                    </Button>
                  </div>
                ) : (
                  <Button type="button" variant="outline" onClick={() => setConfirmClose(true)}>
                    {t("closeAccount")}
                  </Button>
                )}
              </CardContent>
            </Card>
          )}
        </div>
      ) : null}
        </div>
      </div>

      <DashboardBottomBar tabs={tabs} tab={tab} onSelect={goTo} counts={counts} />
    </div>
  );
}
