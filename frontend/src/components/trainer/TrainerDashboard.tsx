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
import {Fragment, useEffect, useState} from "react";

import {DashboardBottomBar, DashboardSidebar} from "@/components/dashboard/DashboardNav";
import {TrainerAccount} from "@/components/trainer/TrainerAccount";
import {TrainerAccountNotice} from "@/components/trainer/TrainerAccountNotice";
import {TrainerEnquiries} from "@/components/trainer/TrainerEnquiries";
import type {TrainerTab} from "@/components/trainer/TrainerNav";
import {TRAINER_TABS} from "@/components/trainer/TrainerNav";
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

function statusMessage(status: string) {
  if (status === "draft") return "Your profile is saved as a draft and is not public.";
  if (status === "pending_approval") {
    return "Skills Hub is reviewing your profile. It is not public until staff approve it.";
  }
  if (status === "published") return "Your workshop profile is live for trainees to find.";
  if (status === "changes_requested") {
    return "Staff asked for changes. Update the draft and submit it again when it is ready.";
  }
  if (status === "suspended") return "This listing is not public. Read the review note below.";
  return "Your listing status is shown below.";
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
  return (
    <div role="status" aria-live="polite" aria-busy="true">
      <span className="sr-only">Loading trainer dashboard…</span>
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
  return (
    <section aria-labelledby="performance-heading" className="space-y-4">
      <div>
        <h2 id="performance-heading" className="text-xl font-bold tracking-tight">
          Your last 30 days
        </h2>
        <p className="mt-1 text-sm text-[var(--color-muted-foreground)]">
          What your listing brought in.
        </p>
      </div>

      {figures ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Figure
            label="Enquiries"
            value={String(figures.enquiries)}
            note="People who asked about your courses."
          />
          <Figure
            label="Replied in 48h"
            value={
              figures.response_rate === null
                ? "—"
                : `${Math.round(figures.response_rate * 100)}%`
            }
            note={
              figures.response_rate === null
                ? "No enquiries yet to measure."
                : figures.response_rate_basis
            }
          />
          <Figure
            label="Enrolments"
            value={String(figures.enrolments)}
            note={figures.enrolments_basis}
          />
          <Figure
            label="Fees from enrolments"
            value={
              // formatFee, not a hand-rolled prefix: it is the same Intl
              // formatter the public listing uses, so an owner comparing
              // the two sees one currency style rather than two.
              figures.enrolment_fees_cedis ? formatFee(figures.enrolment_fees_cedis) : "—"
            }
            note="Recorded by staff, not collected by Skills Hub."
          />
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {[0, 1, 2, 3].map((n) => (
            <Skeleton key={n} className="h-28 rounded-2xl" />
          ))}
        </div>
      )}

      {/* Profile views is null, not zero, and the reason is worth a sentence:
          a zero here would read as "nobody looked", which is a claim the
          software cannot make without an analytics source. */}
      <p className="text-xs leading-5 text-[var(--color-muted-foreground)]">
        Profile views are not counted yet, so they are left blank rather than shown as zero.
      </p>

      {canConfirm ? (
        <div
          className={
            isStale
              ? "rounded-2xl border border-[var(--color-warn)]/30 bg-[var(--color-warn-bg)] p-4"
              : "rounded-2xl border border-[var(--color-border)] bg-[var(--color-muted)]/50 p-4"
          }
        >
          <p className="text-sm font-semibold">
            {isStale
              ? "Your listing is showing as unconfirmed"
              : "Are your fees and dates still right?"}
          </p>
          <p className="mt-1 text-sm leading-6 text-[var(--color-muted-foreground)]">
            {isStale
              ? "Trainees see a note asking them to check before they travel. Confirm to remove it."
              : lastConfirmed
                ? `Last confirmed ${formatDate(lastConfirmed)}.`
                : "Confirming keeps the unconfirmed note off your listing."}
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
            Yes, everything is still correct
          </Button>
        </div>
      ) : null}
    </section>
  );
}

export function TrainerDashboard() {
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
      if ((["overview", "enquiries", "listing", "account"] as string[]).includes(wanted)) {
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
        if (active) setError(reason instanceof Error ? reason.message : "Could not load the dashboard.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

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
      setConfirmNote("Thank you. Your listing shows as up to date.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not confirm the listing.");
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
      setError(reason instanceof Error ? reason.message : "Could not sign out.");
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
          <CardTitle>Dashboard unavailable</CardTitle>
          <CardDescription>{error}</CardDescription>
        </CardHeader>
        <CardFooter>
          <Button type="button" variant="outline" onClick={() => window.location.reload()}>
            Try again
          </Button>
        </CardFooter>
      </Card>
    );
  }

  if (!session?.authenticated) {
    return (
      <EmptyState
        title="Sign in to your trainer profile"
        description="We will send a one-time code to your private phone number, and to your email as well if you have added one."
        action="Sign in"
      />
    );
  }

  const profile = session.profile;
  if (!profile) {
    return (
      <>
      <TrainerAccountNotice session={session} />
      <EmptyState
        title="Create your workshop profile"
        description="No profile has been submitted from this number yet."
        action="Start profile"
      />
      </>
    );
  }

  const appearance = statusAppearance(profile.status);
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
          tabs={TRAINER_TABS}
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
              <p className="truncate text-xs text-[var(--color-muted-foreground)]">
                {profile.status_label}
              </p>
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
                    {profile.status_label}
                  </Badge>
                  <h2
                    id="profile-status-heading"
                    className="mt-3 break-words text-xl font-bold tracking-tight sm:text-2xl"
                  >
                    {profile.name}
                  </h2>
                  <p className="mt-1 max-w-2xl text-sm leading-6 text-[var(--color-muted-foreground)]">
                    {statusMessage(profile.status)}
                  </p>
                </div>
              </div>
              {profile.editable ? (
                <Button asChild variant="outline" className="w-full sm:w-auto">
                  <Link href="/trainer/join">
                    <FilePenLine aria-hidden="true" />
                    Edit draft
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
                    <strong className="block font-semibold">Note from the review team</strong>
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
                  Workshop details
                </h2>
                <CardDescription>Your public workshop information</CardDescription>
              </div>
            </CardHeader>
            <Separator />
            <CardContent className="pt-2 sm:px-6">
              <DetailList
                rows={[
                  {
                    label: "Owner or trainer",
                    value: (
                      <span className="inline-flex items-center gap-1.5">
                        <UserRound aria-hidden="true" className="size-3.5 text-[var(--color-muted-foreground)]" />
                        {profile.owner_name}
                      </span>
                    ),
                  },
                  {
                    label: "Public contact",
                    value: (
                      <span className="inline-flex items-center gap-1.5">
                        <Phone aria-hidden="true" className="size-3.5 text-[var(--color-muted-foreground)]" />
                        {profile.contact_phone}
                      </span>
                    ),
                  },
                  {
                    label: "Area",
                    value: (
                      <span className="inline-flex items-center gap-1.5">
                        <MapPin aria-hidden="true" className="size-3.5 text-[var(--color-muted-foreground)]" />
                        {profile.area.name}
                      </span>
                    ),
                  },
                  {label: "Address", value: profile.address},
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
                    First course
                  </h2>
                  <CardDescription>The course trainees can compare</CardDescription>
                </div>
              </CardHeader>
              <Separator />
              <CardContent className="pt-2 sm:px-6">
                <DetailList
                  rows={[
                    {label: "Course", value: profile.programme.title},
                    {
                      label: "Trade",
                      value: (
                        <span className="inline-flex items-center gap-1.5">
                          <BadgeCheck aria-hidden="true" className="size-3.5 text-[var(--color-muted-foreground)]" />
                          {profile.programme.trade.name}
                        </span>
                      ),
                    },
                    {label: "Fee", value: formatFee(String(profile.programme.fee))},
                    {label: "Duration", value: `${profile.programme.duration_weeks} weeks`},
                    {
                      label: "Next intake",
                      value: profile.programme.intake?.start_date
                        ? formatDate(profile.programme.intake.start_date)
                        : "Date not set",
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
                <CardTitle id="no-course-heading">No course has been added yet.</CardTitle>
                <CardDescription>Add a course so trainees can compare your offer.</CardDescription>
              </CardHeader>
              {profile.editable ? (
                <CardFooter className="sm:px-6">
                  <Button asChild variant="outline" className="w-full sm:w-auto">
                    <Link href="/trainer/join">
                      Add your first course
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
          Your draft is saved on this device while you are signed in.
        </p>
        <Button
          type="button"
          onClick={signOut}
          disabled={busy}
          variant="outline"
          className="w-full sm:w-auto"
        >
          {busy ? <Loader2 aria-hidden="true" className="animate-spin" /> : <LogOut aria-hidden="true" />}
          {busy ? "Signing out…" : "Sign out"}
        </Button>
      </div>
        </div>
      </div>

      <DashboardBottomBar
        tabs={TRAINER_TABS}
        tab={tab}
        onSelect={goTo}
        counts={{enquiries: waitingForReply}}
      />
    </div>
  );
}
