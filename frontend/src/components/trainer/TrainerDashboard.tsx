"use client";

import {
  AlertCircle,
  ArrowRight,
  BadgeCheck,
  BookOpen,
  Building2,
  CalendarDays,
  CheckCircle2,
  Clock3,
  FilePenLine,
  LayoutDashboard,
  Loader2,
  LogOut,
  MapPin,
  MessageCircle,
  Phone,
  ShieldAlert,
  UserRound,
} from "lucide-react";
import Link from "next/link";
import {useTranslations} from "next-intl";
import {Fragment, useEffect, useState} from "react";

import {DashboardBottomBar, DashboardSidebar} from "@/components/dashboard/DashboardNav";
import {TrainerAccount} from "@/components/trainer/TrainerAccount";
import {TrainerAccountNotice} from "@/components/trainer/TrainerAccountNotice";
import {TrainerEnquiries} from "@/components/trainer/TrainerEnquiries";
import type {TrainerTab} from "@/components/trainer/TrainerNav";
import {TRAINER_TAB_KEYS, useTrainerTabs} from "@/components/trainer/TrainerNav";
import {TrainerCourseSales} from "@/components/trainer/TrainerCourseSales";
import {TrainerVideos} from "@/components/trainer/TrainerVideos";
import {Badge} from "@/components/ui/badge";
import {Alert, AlertDescription} from "@/components/ui/alert";
import {Button} from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {Separator} from "@/components/ui/separator";
import {Skeleton} from "@/components/ui/skeleton";
import {BRAND} from "@/lib/brand";
import {formatDate, formatFee} from "@/lib/format";
import {
  confirmListingIsCurrent,
  getTrainerDashboard,
  getTrainerOwnEnquiries,
  getTrainerSession,
  logoutTrainer,
  setTrainerEnquiryReplied,
} from "@/lib/trainer-api";
import type {
  TrainerDashboard as TrainerDashboardData,
  TrainerEnquiry,
  TrainerSession,
} from "@/lib/types";

const KNOWN_STATUSES = ["draft", "pending_approval", "published", "changes_requested", "suspended"];

/** What the listing's status means for the owner, from "TrainerDashboard.statusMessages". */
function statusMessageKey(status: string) {
  return (KNOWN_STATUSES.includes(status) ? status : "other") as
    | "draft"
    | "pending_approval"
    | "published"
    | "changes_requested"
    | "suspended"
    | "other";
}

function statusAppearance(status: string) {
  if (status === "published") {
    return {
      badge: "default" as const,
      Icon: CheckCircle2,
      accent: "from-[var(--color-visit)] via-[var(--color-visit)] to-[var(--color-brand)]",
      iconClass: "bg-[var(--color-visit-bg)] text-[var(--color-visit)]",
    };
  }
  if (status === "pending_approval") {
    return {
      badge: "warning" as const,
      Icon: Clock3,
      accent: "from-[var(--color-warn)] via-[var(--color-brand)] to-[var(--color-primary)]",
      iconClass: "bg-[var(--color-warn-bg)] text-[var(--color-warn)]",
    };
  }
  if (status === "changes_requested" || status === "suspended") {
    return {
      badge: "warning" as const,
      Icon: ShieldAlert,
      accent: "from-[var(--color-warn)] via-[var(--color-destructive)] to-[var(--color-primary)]",
      iconClass: "bg-[var(--color-warn-bg)] text-[var(--color-warn)]",
    };
  }
  return {
    badge: "secondary" as const,
    Icon: FilePenLine,
    accent: "from-[var(--color-brand)] via-[var(--color-brand-strong)] to-[var(--color-primary)]",
    iconClass: "bg-[var(--color-brand-soft)] text-[var(--color-brand-strong)]",
  };
}

function DetailRow({label, value}: {label: string; value: React.ReactNode}) {
  return (
    <div className="grid min-w-0 gap-1 py-3 sm:grid-cols-[minmax(0,9rem)_minmax(0,1fr)] sm:items-start sm:gap-5">
      <dt className="text-xs font-medium text-[var(--color-muted-foreground)] sm:text-sm">{label}</dt>
      <dd className="min-w-0 break-words text-sm font-semibold sm:text-right">{value}</dd>
    </div>
  );
}

function DetailList({
  rows,
}: {
  rows: Array<{label: string; value: React.ReactNode}>;
}) {
  return (
    <dl>
      {rows.map((row, index) => (
        <Fragment key={row.label}>
          <DetailRow label={row.label} value={row.value} />
          {index < rows.length - 1 ? <Separator /> : null}
        </Fragment>
      ))}
    </dl>
  );
}

function DashboardSkeleton() {
  const t = useTranslations("TrainerDashboard");
  return (
    <div role="status" aria-live="polite" aria-busy="true">
      <span className="sr-only">{t("loading")}</span>
      <div aria-hidden="true" className="space-y-5">
        <Card>
          <CardHeader>
            <div className="flex items-center gap-3">
              <Skeleton className="size-12 rounded-xl" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-5 w-28" />
                <Skeleton className="h-7 w-2/3" />
              </div>
            </div>
            <Skeleton className="mt-2 h-4 w-full max-w-lg" />
          </CardHeader>
        </Card>
        <div className="grid gap-5 lg:grid-cols-2">
          {[0, 1].map((item) => (
            <Card key={item}>
              <CardHeader>
                <Skeleton className="h-6 w-40" />
              </CardHeader>
              <CardContent className="space-y-3">
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
}

function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action: string;
}) {
  return (
    <Card className="mx-auto max-w-2xl overflow-hidden text-center">
      <CardHeader className="items-center px-5 pt-8 sm:px-8">
        <div className="mb-2 grid size-14 place-items-center rounded-2xl bg-[var(--color-brand-soft)] text-[var(--color-brand-strong)]">
          <LayoutDashboard aria-hidden="true" className="size-6" />
        </div>
        <CardTitle className="text-xl">{title}</CardTitle>
        <CardDescription className="max-w-md">{description}</CardDescription>
      </CardHeader>
      <CardFooter className="justify-center px-5 pb-8 sm:px-8">
        <Button asChild variant="brand" className="w-full sm:w-auto">
          <Link href="/trainer/join">
            {action}
            <ArrowRight aria-hidden="true" />
          </Link>
        </Button>
      </CardFooter>
    </Card>
  );
}

/**
 * One figure, with the caveat attached to it rather than in a footnote.
 *
 * Every number on this screen is qualified: the response rate only counts
 * replies somebody recorded, and enrolments are collected by asking. Printing
 * a bare figure and burying the definition is how an owner concludes the
 * platform is lying to them the first time it disagrees with their own books.
 */
function Figure({
  label,
  value,
  note,
}: {
  label: string;
  value: string;
  note: string;
}) {
  return (
    <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-card)] p-4">
      <p className="text-xs font-semibold uppercase tracking-[0.1em] text-[var(--color-muted-foreground)]">
        {label}
      </p>
      <p className="mt-1.5 text-3xl font-bold tabular-nums tracking-tight">{value}</p>
      <p className="mt-1.5 text-xs leading-5 text-[var(--color-muted-foreground)]">{note}</p>
    </div>
  );
}

/**
 * Screen 5, on the page the owner is already looking at.
 *
 * Section 05: a subscription renews when the owner can see what it bought. It
 * used to say the performance dashboard was "available through the signed
 * WhatsApp link", which for an owner who deleted that message meant it was
 * available nowhere.
 */
function PerformancePanel({
  figures,
  isStale,
  lastConfirmed,
  canConfirm,
  confirming,
  confirmNote,
  onConfirm,
}: {
  figures: TrainerDashboardData | null;
  isStale: boolean;
  lastConfirmed: string | null;
  canConfirm: boolean;
  confirming: boolean;
  confirmNote: string | null;
  onConfirm: () => void;
}) {
  const t = useTranslations("TrainerDashboard");
  const tFigures = useTranslations("DashboardFigures");
  const tFormat = useTranslations("Format");
  return (
    <section aria-labelledby="performance-heading" className="space-y-4">
      <div>
        <h2 id="performance-heading" className="text-xl font-bold tracking-tight">
          {t("lastDays", {days: figures?.period_days ?? 30})}
        </h2>
        <p className="mt-1 text-sm text-[var(--color-muted-foreground)]">{t("broughtIn")}</p>
      </div>

      {figures ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Figure
            label={tFigures("enquiries")}
            value={String(figures.enquiries)}
            note={t("enquiriesNote")}
          />
          <Figure
            label={tFigures("profileViews")}
            value={String(figures.profile_views)}
            note={
              figures.profile_views_counted_since
                ? `${tFigures("countedSince", {date: formatDate(figures.profile_views_counted_since)})}.`
                : `${tFigures("profileViewsBasis")}.`
            }
          />
          <Figure
            label={tFigures("repliedIn48h")}
            value={
              figures.response_rate === null
                ? "—"
                : `${Math.round(figures.response_rate * 100)}%`
            }
            note={
              figures.response_rate === null ? t("noEnquiriesToMeasure") : tFigures("responseRateBasis")
            }
          />
          {/* The four numbers Section 04 puts on Screen 5. Course fees ride on
              the enrolments tile, as on the signed-link dashboard, so both
              doors show the same four. */}
          <Figure
            label={tFigures("enrolments")}
            value={String(figures.enrolments)}
            note={
              figures.enrolment_fees_cedis
                ? // formatFee, not a hand-rolled prefix: it is the same Intl
                  // formatter the public listing uses, so an owner comparing
                  // the two sees one currency style rather than two.
                  `${tFigures("inCourseFees", {
                    fees: formatFee(figures.enrolment_fees_cedis, tFormat),
                  })}. ${tFigures("enrolmentsBasis", {brand: BRAND})}`
                : tFigures("enrolmentsBasis", {brand: BRAND})
            }
          />
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {[0, 1, 2, 3].map((n) => (
            <Skeleton key={n} className="h-28 rounded-2xl" />
          ))}
        </div>
      )}

      {canConfirm ? (
        <div
          className={
            isStale
              ? "rounded-2xl border border-[var(--color-warn)]/30 bg-[var(--color-warn-bg)] p-4"
              : "rounded-2xl border border-[var(--color-border)] bg-[var(--color-muted)]/50 p-4"
          }
        >
          <p className="text-sm font-semibold">
            {isStale ? t("staleTitle") : t("stillRightTitle")}
          </p>
          <p className="mt-1 text-sm leading-6 text-[var(--color-muted-foreground)]">
            {isStale
              ? t("staleBody")
              : lastConfirmed
                ? t("lastConfirmed", {date: formatDate(lastConfirmed)})
                : t("confirmingKeeps")}
          </p>
          {confirmNote ? (
            <p className="mt-2 text-sm text-[var(--color-visit)]">{confirmNote}</p>
          ) : null}
          <Button
            type="button"
            variant={isStale ? "brand" : "outline"}
            className="mt-3"
            disabled={confirming}
            onClick={onConfirm}
          >
            {confirming ? <Loader2 aria-hidden="true" className="animate-spin" /> : null}
            {t("confirmCorrect")}
          </Button>
        </div>
      ) : null}
    </section>
  );
}

export function TrainerDashboard() {
  const t = useTranslations("TrainerDashboard");
  const tStatus = useTranslations("ListingStatus");
  const tFormat = useTranslations("Format");
  const tabs = useTrainerTabs();
  const [session, setSession] = useState<TrainerSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [figures, setFigures] = useState<TrainerDashboardData | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [confirmNote, setConfirmNote] = useState<string | null>(null);
  const [enquiries, setEnquiries] = useState<TrainerEnquiry[]>([]);
  const [enquiriesLoading, setEnquiriesLoading] = useState(true);
  const [tab, setTab] = useState<TrainerTab>("overview");

  // Deep links, both ways, so a reload comes back to the tab you were on. A
  // hash rather than a query: no Suspense boundary, and the server has no
  // business knowing which tab of their own workspace someone is reading.
  useEffect(() => {
    const apply = () => {
      const wanted = window.location.hash.replace(/^#/, "");
      if ((TRAINER_TAB_KEYS as string[]).includes(wanted)) {
        setTab(wanted as TrainerTab);
      }
    };
    apply();
    window.addEventListener("hashchange", apply);
    return () => window.removeEventListener("hashchange", apply);
  }, []);

  function goTo(next: TrainerTab) {
    setTab(next);
    if (typeof window !== "undefined") window.history.replaceState(null, "", `#${next}`);
  }

  useEffect(() => {
    let active = true;
    getTrainerSession()
      .then((next) => {
        if (active) setSession(next);
        // Only a listing that exists has numbers. A failure here is not worth
        // an error banner over the whole page: the status card above is still
        // useful, and the figures are the part that can be missing.
        if (next.authenticated && next.profile) {
          getTrainerDashboard()
            .then((data) => {
              if (active) setFigures(data);
            })
            .catch(() => undefined);
          // Same reasoning: an owner with no enquiries yet and an owner whose
          // enquiries failed to load both see the empty state rather than the
          // whole page turning into an error.
          getTrainerOwnEnquiries()
            .then((rows) => {
              if (active) setEnquiries(rows);
            })
            .catch(() => undefined)
            .finally(() => {
              if (active) setEnquiriesLoading(false);
            });
        } else if (active) {
          setEnquiriesLoading(false);
        }
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
  }, [t]);

  async function markReplied(referenceCode: string, replied: boolean) {
    const saved = await setTrainerEnquiryReplied(referenceCode, replied);
    // The server's answer, not the optimistic guess: if it disagreed, the row
    // should show what was actually stored.
    setEnquiries((current) =>
      current.map((enquiry) =>
        enquiry.reference_code === referenceCode
          ? {...enquiry, replied: saved.replied}
          : enquiry,
      ),
    );
    // The response rate on the overview counts replies, so it is now stale.
    const refreshed = await getTrainerDashboard().catch(() => null);
    if (refreshed) setFigures(refreshed);
  }

  async function confirmStillCurrent() {
    setConfirming(true);
    setError(null);
    try {
      const profile = await confirmListingIsCurrent();
      setSession((current) =>
        current && current.authenticated ? {...current, profile} : current,
      );
      const refreshed = await getTrainerDashboard().catch(() => null);
      if (refreshed) setFigures(refreshed);
      setConfirmNote(t("confirmedThanks"));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t("confirmFailed"));
    } finally {
      setConfirming(false);
    }
  }

  async function signOut() {
    setBusy(true);
    setError(null);
    try {
      const next = await logoutTrainer();
      sessionStorage.removeItem("skillshub.trainer.public-profile-draft");
      setSession(next);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t("signOutFailed"));
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <DashboardSkeleton />;

  if (error && !session) {
    return (
      <Card role="alert" className="mx-auto max-w-2xl border-[var(--color-warn)]/20">
        <CardHeader className="items-start">
          <div className="mb-2 grid size-11 place-items-center rounded-xl bg-[var(--color-warn-bg)] text-[var(--color-warn)]">
            <AlertCircle aria-hidden="true" className="size-5" />
          </div>
          <CardTitle>{t("unavailableTitle")}</CardTitle>
          <CardDescription>{error}</CardDescription>
        </CardHeader>
        <CardFooter>
          <Button type="button" variant="outline" onClick={() => window.location.reload()}>
            {t("tryAgain")}
          </Button>
        </CardFooter>
      </Card>
    );
  }

  if (!session?.authenticated) {
    return (
      <EmptyState title={t("signInTitle")} description={t("signInBody")} action={t("signIn")} />
    );
  }

  const profile = session.profile;
  if (!profile) {
    return (
      <>
      <TrainerAccountNotice session={session} />
      <EmptyState title={t("createTitle")} description={t("createBody")} action={t("startProfile")} />
      </>
    );
  }

  const appearance = statusAppearance(profile.status);
  // Worded from the status code; a code this build does not know shows the
  // label the server sent.
  const statusLabel = tStatus.has(profile.status as "draft")
    ? tStatus(profile.status as "draft")
    : profile.status_label;
  const StatusIcon = appearance.Icon;
  // What the badge counts. Answering is the job; how many have arrived is not
  // the number an owner needs on a tab.
  const waitingForReply = enquiries.filter((enquiry) => !enquiry.replied).length;

  return (
    /* pb-20 on a phone clears the fixed bottom bar; the sidebar replaces it
       from lg up, where the padding is no longer wanted. */
    <div className="pb-20 lg:pb-0" data-trainer-dashboard>
      <TrainerAccountNotice session={session} />

      <div className="gap-7 lg:grid lg:grid-cols-[15rem_minmax(0,1fr)]">
        <DashboardSidebar
          tabs={tabs}
          tab={tab}
          onSelect={goTo}
          counts={{enquiries: waitingForReply}}
          onSignOut={signOut}
          busy={busy}
          canSignOut
        >
          <div className="flex items-center gap-3 rounded-2xl border border-[var(--color-border)] bg-[var(--color-card)] p-4 shadow-[var(--shadow-card)]">
            <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-[var(--color-brand-soft)] text-[var(--color-brand-strong)]">
              <Building2 aria-hidden="true" className="size-5" />
            </span>
            <div className="min-w-0">
              <p className="truncate text-sm font-bold leading-5">{profile.name}</p>
              <p className="truncate text-xs text-[var(--color-muted-foreground)]">{statusLabel}</p>
            </div>
          </div>
        </DashboardSidebar>

        <div className="min-w-0 space-y-5">
      {/* The status card sits on every tab. It is the answer to "is my listing
          live", which is the question an owner opens this page with, and
          burying it behind a tab would make them hunt for it. */}
      <section aria-labelledby="profile-status-heading" aria-live="polite">
        <Card className="relative overflow-hidden">
          <div
            aria-hidden="true"
            className={`absolute inset-x-0 top-0 h-1 bg-gradient-to-r ${appearance.accent}`}
          />
          <CardHeader className="pb-5 pt-7 sm:px-6">
            <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
              <div className="flex min-w-0 items-start gap-4">
                <div className={`grid size-12 shrink-0 place-items-center rounded-2xl ${appearance.iconClass}`}>
                  <StatusIcon aria-hidden="true" className="size-5" />
                </div>
                <div className="min-w-0">
                  <Badge variant={appearance.badge}>
                    <StatusIcon aria-hidden="true" />
                    {statusLabel}
                  </Badge>
                  <h2
                    id="profile-status-heading"
                    className="mt-3 break-words text-xl font-bold tracking-tight sm:text-2xl"
                  >
                    {profile.name}
                  </h2>
                  <p className="mt-1 max-w-2xl text-sm leading-6 text-[var(--color-muted-foreground)]">
                    {t(`statusMessages.${statusMessageKey(profile.status)}`)}
                  </p>
                </div>
              </div>
              {profile.editable ? (
                <Button asChild variant="outline" className="w-full sm:w-auto">
                  <Link href="/trainer/join">
                    <FilePenLine aria-hidden="true" />
                    {t("editDraft")}
                  </Link>
                </Button>
              ) : null}
            </div>
          </CardHeader>
          {profile.review_note ? (
            <>
              <Separator />
              <CardContent className="pt-5 sm:px-6">
                <div className="flex items-start gap-3 rounded-xl border border-[var(--color-warn)]/20 bg-[var(--color-warn-bg)] p-4 text-sm">
                  <MessageCircle
                    aria-hidden="true"
                    className="mt-0.5 size-4 shrink-0 text-[var(--color-warn)]"
                  />
                  <div>
                    <strong className="block font-semibold">{t("reviewNote")}</strong>
                    <p className="mt-1 leading-6 text-[var(--color-muted-foreground)]">
                      {profile.review_note}
                    </p>
                  </div>
                </div>
              </CardContent>
            </>
          ) : null}
        </Card>
      </section>

      {tab === "enquiries" ? (
        <TrainerEnquiries
          enquiries={enquiries}
          loading={enquiriesLoading}
          onToggleReplied={markReplied}
        />
      ) : null}

      {tab === "videos" ? (
        <div className="space-y-5">
          <TrainerCourseSales />
          <TrainerVideos listingLive={profile.status === "published"} />
        </div>
      ) : null}

      {tab === "account" ? (
        <TrainerAccount
          session={session}
          onSession={(next) => setSession(next)}
        />
      ) : null}

      {tab === "listing" ? (
      <div className="grid items-stretch gap-5 lg:grid-cols-2">
        <section aria-labelledby="workshop-details-heading">
          <Card className="h-full">
            <CardHeader className="flex-row items-center gap-3 pb-4 sm:px-6">
              <div className="grid size-10 shrink-0 place-items-center rounded-xl bg-[var(--color-brand-soft)] text-[var(--color-brand-strong)]">
                <Building2 aria-hidden="true" className="size-4" />
              </div>
              <div>
                <h2 id="workshop-details-heading" className="font-semibold">
                  {t("workshopDetails")}
                </h2>
                <CardDescription>{t("workshopDetailsBody")}</CardDescription>
              </div>
            </CardHeader>
            <Separator />
            <CardContent className="pt-2 sm:px-6">
              <DetailList
                rows={[
                  {
                    label: t("ownerOrTrainer"),
                    value: (
                      <span className="inline-flex items-center gap-1.5">
                        <UserRound aria-hidden="true" className="size-3.5 text-[var(--color-muted-foreground)]" />
                        {profile.owner_name}
                      </span>
                    ),
                  },
                  {
                    label: t("publicContact"),
                    value: (
                      <span className="inline-flex items-center gap-1.5">
                        <Phone aria-hidden="true" className="size-3.5 text-[var(--color-muted-foreground)]" />
                        {profile.contact_phone}
                      </span>
                    ),
                  },
                  {
                    label: t("area"),
                    value: (
                      <span className="inline-flex items-center gap-1.5">
                        <MapPin aria-hidden="true" className="size-3.5 text-[var(--color-muted-foreground)]" />
                        {profile.area.name}
                      </span>
                    ),
                  },
                  {label: t("address"), value: profile.address},
                ]}
              />
            </CardContent>
          </Card>
        </section>

        {profile.programme ? (
          <section aria-labelledby="course-details-heading">
            <Card className="h-full">
              <CardHeader className="flex-row items-center gap-3 pb-4 sm:px-6">
                <div className="grid size-10 shrink-0 place-items-center rounded-xl bg-[var(--color-brand-soft)] text-[var(--color-brand-strong)]">
                  <BookOpen aria-hidden="true" className="size-4" />
                </div>
                <div>
                  <h2 id="course-details-heading" className="font-semibold">
                    {t("firstCourse")}
                  </h2>
                  <CardDescription>{t("firstCourseBody")}</CardDescription>
                </div>
              </CardHeader>
              <Separator />
              <CardContent className="pt-2 sm:px-6">
                <DetailList
                  rows={[
                    {label: t("course"), value: profile.programme.title},
                    {
                      label: t("trade"),
                      value: (
                        <span className="inline-flex items-center gap-1.5">
                          <BadgeCheck aria-hidden="true" className="size-3.5 text-[var(--color-muted-foreground)]" />
                          {profile.programme.trade.name}
                        </span>
                      ),
                    },
                    {label: t("fee"), value: formatFee(String(profile.programme.fee), tFormat)},
                    {
                      label: t("duration"),
                      value: tFormat("weeks", {count: profile.programme.duration_weeks}),
                    },
                    {
                      label: t("nextIntake"),
                      value: profile.programme.intake?.start_date
                        ? formatDate(profile.programme.intake.start_date)
                        : t("dateNotSet"),
                    },
                  ]}
                />
              </CardContent>
            </Card>
          </section>
        ) : (
          <section aria-labelledby="no-course-heading">
            <Card className="h-full">
              <CardHeader className="sm:px-6">
                <div className="mb-1 grid size-10 place-items-center rounded-xl bg-[var(--color-muted)] text-[var(--color-muted-foreground)]">
                  <BookOpen aria-hidden="true" className="size-4" />
                </div>
                <CardTitle id="no-course-heading">{t("noCourseTitle")}</CardTitle>
                <CardDescription>{t("noCourseBody")}</CardDescription>
              </CardHeader>
              {profile.editable ? (
                <CardFooter className="sm:px-6">
                  <Button asChild variant="outline" className="w-full sm:w-auto">
                    <Link href="/trainer/join">
                      {t("addFirstCourse")}
                      <ArrowRight aria-hidden="true" />
                    </Link>
                  </Button>
                </CardFooter>
              ) : null}
            </Card>
          </section>
        )}
      </div>
      ) : null}

      {tab === "overview" && profile.status === "published" ? (
        <PerformancePanel
          figures={figures}
          isStale={profile.is_stale}
          lastConfirmed={profile.last_confirmed_at}
          canConfirm={profile.can_confirm}
          confirming={confirming}
          confirmNote={confirmNote}
          onConfirm={confirmStillCurrent}
        />
      ) : null}

      {error ? (
        <Alert variant="warning">
          <AlertCircle aria-hidden="true" />
          <AlertDescription>
            <p>{error}</p>
          </AlertDescription>
        </Alert>
      ) : null}

      <div className="flex flex-col gap-3 border-t border-[var(--color-border)] pt-5 sm:flex-row sm:items-center sm:justify-between lg:hidden">
        <p className="flex items-center gap-2 text-xs text-[var(--color-muted-foreground)]">
          <CalendarDays aria-hidden="true" className="size-3.5" />
          {t("draftSaved")}
        </p>
        <Button
          type="button"
          onClick={signOut}
          disabled={busy}
          variant="outline"
          className="w-full sm:w-auto"
        >
          {busy ? <Loader2 aria-hidden="true" className="animate-spin" /> : <LogOut aria-hidden="true" />}
          {busy ? t("signingOut") : t("signOut")}
        </Button>
      </div>
        </div>
      </div>

      <DashboardBottomBar
        tabs={tabs}
        tab={tab}
        onSelect={goTo}
        counts={{enquiries: waitingForReply}}
      />
    </div>
  );
}
