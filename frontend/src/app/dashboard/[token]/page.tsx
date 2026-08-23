/**
 * Screen 5: the workshop dashboard.
 *
 * Reached from a tokenised WhatsApp link — no password, no username, nothing to
 * remember. A subscription renews when the owner can see what it bought, so the
 * page leads with the four numbers that justify the fee.
 *
 * Two of those numbers are honest about their limits, and the interface says so
 * rather than presenting a figure the software cannot support. That is a
 * deliberate choice: a provider who later discovers the numbers were guesses
 * will not renew, and will tell other workshop owners why.
 */

import type { Metadata } from "next";

import { BRAND } from "@/lib/brand";
import { getDashboard } from "@/lib/api";
import { formatDate } from "@/lib/format";

export const metadata: Metadata = {
  title: "Your workshop dashboard",
  robots: { index: false, follow: false },
};

// Per-owner data behind a signed link: never cached, never statically rendered.
export const dynamic = "force-dynamic";

function Stat({
  label,
  value,
  note,
}: {
  label: string;
  value: string;
  note?: string;
}) {
  return (
    <div className="card p-3">
      <p className="text-xs uppercase tracking-wide text-[var(--color-muted-foreground)]">{label}</p>
      <p className="mt-1 text-2xl font-bold tabular-nums">{value}</p>
      {note && <p className="mt-1 text-xs text-[var(--color-muted-foreground)]">{note}</p>}
    </div>
  );
}

export default async function DashboardPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const data = await getDashboard(token).catch(() => null);

  if (!data) {
    return (
      <div className="p-4">
        <h1 className="text-lg font-bold">This link is not valid</h1>
        <p className="mt-2 text-sm">
          Dashboard links expire. Ask {BRAND} to send you a new one on WhatsApp.
        </p>
      </div>
    );
  }

  return (
    <div className="px-3 py-4 lg:px-6 lg:py-8">
      <h1 className="text-xl font-bold lg:text-3xl">{data.provider.name}</h1>
      <p className="mt-1 text-sm text-[var(--color-muted-foreground)]">
        Last {data.period_days} days
      </p>

      {/* Two up on a phone, four across on a desktop: the screen leads with the
          numbers that justify the subscription, so they should be readable in
          one glance on whichever device the owner opens the link on. */}
      <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4">
        <Stat label="Enquiries" value={String(data.enquiries)} />
        <Stat
          label="Profile views"
          // Null means "not measured", and it is shown that way. A zero here
          // would tell a paying provider that nobody looked, which is a
          // different and false claim.
          value={data.profile_views === null ? "Not measured" : String(data.profile_views)}
          note={data.profile_views === null ? "Coming when analytics are added" : undefined}
        />
        <Stat
          label="Response rate"
          value={
            data.response_rate === null ? "—" : `${Math.round(data.response_rate * 100)}%`
          }
          note={data.response_rate_basis}
        />
        <Stat
          label="Enrolments"
          value={String(data.enrolments)}
          note={
            data.enrolment_fees_cedis ? `GH₵${data.enrolment_fees_cedis} in course fees` : undefined
          }
        />
      </div>

      <p className="mt-3 max-w-prose rounded-lg border border-[var(--color-border)] bg-[var(--color-muted)] p-3 text-xs text-[var(--color-muted-foreground)]">
        {data.enrolments_basis}
      </p>

      <section className="mt-6 lg:max-w-lg">
        <h2 className="text-base font-semibold">Your listing</h2>
        <dl className="mt-2 card p-3 text-sm">
          <div className="flex justify-between py-1">
            <dt className="text-[var(--color-muted-foreground)]">Status</dt>
            <dd className="font-medium capitalize">{data.listing.status.replace(/_/g, " ")}</dd>
          </div>
          <div className="flex justify-between py-1">
            <dt className="text-[var(--color-muted-foreground)]">Details last confirmed</dt>
            <dd className="font-medium">{formatDate(data.listing.last_confirmed_at)}</dd>
          </div>
        </dl>
        {data.listing.is_stale && (
          <p className="mt-2 rounded-lg border border-[var(--color-warn)]/20 bg-[var(--color-warn-bg)] p-3 text-sm text-[var(--color-warn)]">
            Trainees are told these details may be out of date. Confirm your fees and intake
            dates with {BRAND} to remove that notice.
          </p>
        )}
      </section>

      {data.subscription && (
        <section className="mt-6 lg:max-w-lg">
          <h2 className="text-base font-semibold">Subscription</h2>
          <p className="mt-2 card p-3 text-sm">
            {data.subscription.tier} · GH₵{data.subscription.price} · renews{" "}
            {formatDate(data.subscription.period_end)}
          </p>
        </section>
      )}
    </div>
  );
}
