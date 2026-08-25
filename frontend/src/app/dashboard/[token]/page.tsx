/**
 * Screen 5: the workshop dashboard.
 *
 * Legacy read-only access from a tokenised WhatsApp link. Trainers now have a
 * phone-verified profile area for creating and managing approval-bound drafts;
 * this private link remains the shortest route to the performance numbers.
 *
 * Unknown metrics remain visibly unknown. A provider must never be shown a
 * guessed zero for data the product does not measure.
 */

import {
  AlertCircle,
  ArrowRight,
  BarChart3,
  CalendarClock,
  CheckCircle2,
  Clock3,
  Eye,
  FilePenLine,
  GraduationCap,
  Info,
  LockKeyhole,
  MessageCircle,
  RefreshCw,
  ShieldCheck,
  UsersRound,
  type LucideIcon,
} from "lucide-react";
import type {Metadata} from "next";
import Link from "next/link";

import {Alert, AlertDescription, AlertTitle} from "@/components/ui/alert";
import {Badge} from "@/components/ui/badge";
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
import {getDashboard} from "@/lib/api";
import {BRAND} from "@/lib/brand";
import {formatDate, formatFee} from "@/lib/format";

export const metadata: Metadata = {
  title: "Your workshop dashboard",
  robots: {index: false, follow: false},
};

// Per-owner data behind a signed link: never cached, never statically rendered.
export const dynamic = "force-dynamic";

function Stat({
  label,
  value,
  note,
  icon: Icon,
}: {
  label: string;
  value: string;
  note?: string;
  icon: LucideIcon;
}) {
  return (
    <Card className="min-w-0 overflow-hidden">
      <CardContent className="p-4 sm:p-5">
        <div className="flex items-start justify-between gap-3">
          <p className="text-xs font-semibold uppercase tracking-[0.13em] text-[var(--color-muted-foreground)]">
            {label}
          </p>
          <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-[var(--color-brand-soft)] text-[var(--color-brand-strong)]">
            <Icon aria-hidden="true" className="size-4" />
          </span>
        </div>
        <p className="mt-3 break-words text-xl font-bold tabular-nums tracking-tight sm:text-2xl">
          {value}
        </p>
        {note ? (
          <p className="mt-1.5 text-xs leading-5 text-[var(--color-muted-foreground)]">{note}</p>
        ) : null}
      </CardContent>
    </Card>
  );
}

function listingStatusVariant(status: string): "default" | "secondary" | "warning" | "outline" {
  if (status === "published" || status === "active") return "default";
  if (status === "stale" || status === "suspended" || status === "changes_requested") {
    return "warning";
  }
  if (status === "draft" || status === "pending_approval") return "secondary";
  return "outline";
}

function listingStatusLabel(status: string) {
  return status.replace(/_/g, " ");
}

export default async function DashboardPage({
  params,
}: {
  params: Promise<{token: string}>;
}) {
  const {token} = await params;
  const data = await getDashboard(token).catch(() => null);

  if (!data) {
    return (
      <div className="relative isolate mx-auto min-h-[60dvh] max-w-2xl overflow-hidden px-3 py-8 sm:py-12 lg:px-6">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -right-24 -top-24 -z-10 size-64 rounded-full bg-[var(--color-brand-soft)] blur-3xl"
        />
        <Card className="overflow-hidden text-center">
          <CardHeader className="items-center px-5 pt-8 sm:px-8">
            <div className="mb-2 grid size-14 place-items-center rounded-2xl bg-[var(--color-warn-bg)] text-[var(--color-warn)]">
              <AlertCircle aria-hidden="true" className="size-6" />
            </div>
            <h1 className="text-2xl font-bold tracking-tight">This link is not valid</h1>
            <CardDescription className="max-w-md">
              Dashboard links expire. Ask {BRAND} to send you a new one on WhatsApp.
            </CardDescription>
          </CardHeader>
          <CardFooter className="justify-center px-5 pb-8 sm:px-8">
            <Button asChild variant="outline" className="w-full sm:w-auto">
              <Link href="/trainer/join">
                Sign in to manage your profile
                <ArrowRight aria-hidden="true" />
              </Link>
            </Button>
          </CardFooter>
        </Card>
      </div>
    );
  }

  return (
    <div className="relative isolate mx-auto max-w-5xl overflow-hidden px-3 py-5 sm:py-7 lg:px-6 lg:py-10">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -right-28 -top-32 -z-10 size-72 rounded-full bg-[var(--color-brand-soft)]/70 blur-3xl"
      />

      <header className="mb-6 flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <Badge variant="secondary">
            <LockKeyhole aria-hidden="true" />
            Private signed link
          </Badge>
          <h1 className="mt-4 break-words text-3xl font-bold tracking-[-0.035em] sm:text-4xl">
            {data.provider.name}
          </h1>
          <p className="mt-2 flex items-center gap-2 text-sm text-[var(--color-muted-foreground)]">
            <CalendarClock aria-hidden="true" className="size-4" />
            Performance from the last {data.period_days} days
          </p>
        </div>
        <Button asChild variant="outline" className="w-full sm:w-auto">
          <Link href="/trainer/join">
            <FilePenLine aria-hidden="true" />
            Manage your workshop profile
          </Link>
        </Button>
      </header>

      {/* Two up on a phone, four across on a desktop. Null values are kept
          distinct from real zeros so the performance story stays honest. */}
      <section aria-label="Workshop performance">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4">
          <Stat label="Enquiries" value={String(data.enquiries)} icon={MessageCircle} />
          <Stat
            label="Profile views"
            value={data.profile_views === null ? "Not measured" : String(data.profile_views)}
            note={data.profile_views === null ? "Coming when analytics are added" : undefined}
            icon={Eye}
          />
          <Stat
            label="Response rate"
            value={data.response_rate === null ? "—" : `${Math.round(data.response_rate * 100)}%`}
            note={data.response_rate_basis}
            icon={BarChart3}
          />
          <Stat
            label="Enrolments"
            value={String(data.enrolments)}
            note={
              data.enrolment_fees_cedis
                ? `${formatFee(data.enrolment_fees_cedis)} in course fees`
                : undefined
            }
            icon={GraduationCap}
          />
        </div>
      </section>

      <div className="mt-5 flex items-start gap-3 rounded-2xl border border-[var(--color-border)] bg-[var(--color-card)]/75 p-4 text-xs leading-5 text-[var(--color-muted-foreground)] shadow-xs">
        <Info aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-[var(--color-brand-strong)]" />
        <p>{data.enrolments_basis}</p>
      </div>

      <div className="mt-5 grid items-start gap-5 lg:grid-cols-[minmax(0,1.15fr)_minmax(18rem,0.85fr)]">
        <section aria-labelledby="signed-listing-heading">
          <Card>
            <CardHeader className="flex-row items-start justify-between gap-4 pb-4 sm:px-6">
              <div>
                <div className="mb-3 grid size-10 place-items-center rounded-xl bg-[var(--color-brand-soft)] text-[var(--color-brand-strong)]">
                  <ShieldCheck aria-hidden="true" className="size-4" />
                </div>
                <h2 id="signed-listing-heading" className="font-semibold">
                  Your listing
                </h2>
                <CardDescription>Current public listing health</CardDescription>
              </div>
              <Badge variant={listingStatusVariant(data.listing.status)} className="capitalize">
                {data.listing.is_stale ? (
                  <Clock3 aria-hidden="true" />
                ) : (
                  <CheckCircle2 aria-hidden="true" />
                )}
                {listingStatusLabel(data.listing.status)}
              </Badge>
            </CardHeader>
            <Separator />
            <CardContent className="pt-2 sm:px-6">
              <dl>
                <div className="grid gap-1 py-3 sm:grid-cols-[minmax(0,12rem)_minmax(0,1fr)] sm:gap-5">
                  <dt className="text-sm text-[var(--color-muted-foreground)]">Status</dt>
                  <dd className="break-words text-sm font-semibold capitalize sm:text-right">
                    {listingStatusLabel(data.listing.status)}
                  </dd>
                </div>
                <Separator />
                <div className="grid gap-1 py-3 sm:grid-cols-[minmax(0,12rem)_minmax(0,1fr)] sm:gap-5">
                  <dt className="text-sm text-[var(--color-muted-foreground)]">
                    Details last confirmed
                  </dt>
                  <dd className="break-words text-sm font-semibold sm:text-right">
                    {formatDate(data.listing.last_confirmed_at)}
                  </dd>
                </div>
              </dl>
              {data.listing.is_stale ? (
                <Alert variant="warning" className="mt-3">
                  <RefreshCw aria-hidden="true" />
                  <AlertTitle>Details may be out of date</AlertTitle>
                  <AlertDescription>
                    <p>
                      Trainees see this notice. Confirm your fees and intake dates with {BRAND} to remove it.
                    </p>
                  </AlertDescription>
                </Alert>
              ) : null}
            </CardContent>
          </Card>
        </section>

        <div className="grid gap-5">
          <section aria-labelledby="profile-management-heading">
            <Card className="overflow-hidden">
              <CardHeader className="sm:px-6">
                <div className="mb-1 grid size-10 place-items-center rounded-xl bg-[var(--color-brand-soft)] text-[var(--color-brand-strong)]">
                  <UsersRound aria-hidden="true" className="size-4" />
                </div>
                <CardTitle id="profile-management-heading">Profile management</CardTitle>
                <CardDescription>
                  Sign in with your private phone number. Changes are reviewed before they become public.
                </CardDescription>
              </CardHeader>
              <CardFooter className="sm:px-6">
                <Button asChild variant="brand" className="w-full">
                  <Link href="/trainer/join">
                    Manage your workshop profile
                    <ArrowRight aria-hidden="true" />
                  </Link>
                </Button>
              </CardFooter>
            </Card>
          </section>

          {data.subscription ? (
            <section aria-labelledby="subscription-heading">
              <Card>
                <CardHeader className="pb-4 sm:px-6">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <h2 id="subscription-heading" className="font-semibold">
                        Subscription
                      </h2>
                      <CardDescription>Your current plan</CardDescription>
                    </div>
                    <Badge variant="outline">{data.subscription.tier}</Badge>
                  </div>
                </CardHeader>
                <Separator />
                <CardContent className="pt-5 sm:px-6">
                  <p className="text-2xl font-bold tabular-nums">
                    {formatFee(data.subscription.price)}
                  </p>
                  <p className="mt-1 flex items-center gap-2 text-xs text-[var(--color-muted-foreground)]">
                    <CalendarClock aria-hidden="true" className="size-3.5" />
                    Renews {formatDate(data.subscription.period_end)}
                  </p>
                </CardContent>
              </Card>
            </section>
          ) : null}
        </div>
      </div>
    </div>
  );
}
