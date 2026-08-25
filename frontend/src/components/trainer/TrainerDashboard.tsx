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
  LockKeyhole,
  LogOut,
  MapPin,
  MessageCircle,
  Phone,
  ShieldAlert,
  UserRound,
} from "lucide-react";
import Link from "next/link";
import {Fragment, useEffect, useState} from "react";

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
import {getTrainerSession, logoutTrainer} from "@/lib/trainer-api";
import type {TrainerSession} from "@/lib/types";

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

export function TrainerDashboard() {
  const [session, setSession] = useState<TrainerSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    getTrainerSession()
      .then((next) => {
        if (active) setSession(next);
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
        description="We will send a one-time code to your private phone number."
        action="Sign in"
      />
    );
  }

  const profile = session.profile;
  if (!profile) {
    return (
      <EmptyState
        title="Create your workshop profile"
        description="No profile has been submitted from this number yet."
        action="Start profile"
      />
    );
  }

  const appearance = statusAppearance(profile.status);
  const StatusIcon = appearance.Icon;

  return (
    <div className="space-y-5" data-trainer-dashboard>
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

      {profile.status === "published" ? (
        <section
          aria-label="Private performance dashboard"
          className="flex items-start gap-3 rounded-2xl border border-[var(--color-border)] bg-[var(--color-muted)]/50 p-4 text-sm leading-6"
        >
          <LockKeyhole
            aria-hidden="true"
            className="mt-1 size-4 shrink-0 text-[var(--color-brand-strong)]"
          />
          <p>
            Your private performance and enquiry dashboard remains available through the signed WhatsApp link sent by Skills Hub.
          </p>
        </section>
      ) : null}

      {error ? (
        <Alert variant="warning">
          <AlertCircle aria-hidden="true" />
          <AlertDescription>
            <p>{error}</p>
          </AlertDescription>
        </Alert>
      ) : null}

      <div className="flex flex-col gap-3 border-t border-[var(--color-border)] pt-5 sm:flex-row sm:items-center sm:justify-between">
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
  );
}
