/**
 * Screen 3: the provider profile. The screen the whole business depends on.
 *
 * Everything above the fold answers one question: should I trust this workshop
 * with my money. The verification stamp states what was actually done, in plain
 * words, and then says outright that it is not a government accreditation.
 * Government status is a separate block with its own rows, one of which can
 * read "Not claimed".
 *
 * Layout: on a phone this is a single column in source order — trust first,
 * then the courses. On a desktop the two trust blocks move into a sticky aside
 * so they stay beside the courses while the reader scrolls, because the
 * question they answer applies to every course on the page rather than only the
 * one at the top.
 */

import Image from "next/image";
import Link from "next/link";

import { BRAND } from "@/lib/brand";
import { formatDate, formatDuration, formatFee } from "@/lib/format";
import type { ProviderDetail } from "@/lib/types";

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4 border-b border-[var(--color-border)] py-2 last:border-0">
      <dt className="text-sm text-[var(--color-muted-foreground)]">{label}</dt>
      <dd className="text-right text-sm font-medium">{value}</dd>
    </div>
  );
}

function VerificationBlock({ provider }: { provider: ProviderDetail }) {
  const latestVisit = provider.verifications[0] ?? null;

  return (
    <section className="mx-3 mt-4 card p-3 lg:mx-0">
      <h2 className="text-sm font-semibold">{BRAND} verification</h2>
      {latestVisit ? (
        <>
          <p className="mt-1 text-sm">{latestVisit.checks_performed}</p>
          <p className="mt-2 text-xs text-[var(--color-muted-foreground)]">
            Visited {formatDate(latestVisit.visited_on)}
            {latestVisit.officer ? ` by ${latestVisit.officer}` : ""}.
          </p>
        </>
      ) : (
        <p className="mt-1 text-sm text-[var(--color-muted-foreground)]">
          {BRAND} has not visited this workshop. Everything below was supplied by the provider
          and has not been checked by us.
        </p>
      )}
      <p className="mt-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-muted)] px-2 py-1.5 text-xs text-[var(--color-muted-foreground)]">
        A {BRAND} visit is not a government accreditation. It records what our officer saw on
        the day.
      </p>
    </section>
  );
}

function GovernmentBlock({ provider }: { provider: ProviderDetail }) {
  const government = provider.government_status_detail;

  return (
    <section className="mx-3 mt-3 card p-3 lg:mx-0">
      <h2 className="text-sm font-semibold">Government status</h2>
      <dl className="mt-1">
        <Row
          label="CTVET registration"
          value={government ? government.registration_status_display : "Not claimed"}
        />
        {government?.registration_number ? (
          <Row label="Registration number" value={government.registration_number} />
        ) : null}
        <Row
          label="Accreditation"
          value={government ? government.accreditation_status_display : "Not claimed"}
        />
        {government?.source_note ? <Row label="Source" value={government.source_note} /> : null}
      </dl>
      <p className="mt-2 text-xs text-[var(--color-muted-foreground)]">
        Shown exactly as documented. {BRAND} does not infer this status.
      </p>
    </section>
  );
}

function Programmes({ provider }: { provider: ProviderDetail }) {
  return (
    <section className="mx-3 mt-4 lg:order-1 lg:mx-0">
      <h2 className="text-base font-semibold lg:text-lg">Training offered</h2>
      {provider.programmes.map((programme) => {
        const nextIntake = programme.intakes[0] ?? null;
        return (
          <div key={programme.id} className="mt-2 card p-3">
            <h3 className="font-semibold">{programme.title}</h3>
            {/* A plain list, not prose. */}
            <dl className="mt-2">
              <Row label="Fee" value={formatFee(programme.fee)} />
              <Row
                label="Instalments"
                value={
                  programme.instalments_allowed
                    ? programme.instalment_note || "Allowed"
                    : "Full payment"
                }
              />
              <Row label="Duration" value={formatDuration(programme.duration_weeks)} />
              {programme.hours_per_week ? (
                <Row label="Hours a week" value={`${programme.hours_per_week}`} />
              ) : null}
              {programme.weekly_schedule ? (
                <Row label="Schedule" value={programme.weekly_schedule} />
              ) : null}
              <Row
                label="Next intake"
                value={nextIntake ? formatDate(nextIntake.start_date) : "Ask the provider"}
              />
              {nextIntake && nextIntake.places_remaining !== null ? (
                <Row label="Places remaining" value={`${nextIntake.places_remaining}`} />
              ) : null}
            </dl>

            <Link
              href={`/enquiry?programme=${programme.id}${nextIntake ? `&intake=${nextIntake.id}` : ""}`}
              className="tap mt-3 w-full rounded-md bg-[var(--color-primary)] px-6 font-medium text-[var(--color-primary-foreground)] sm:w-auto"
            >
              Enquire about this course
            </Link>
          </div>
        );
      })}
    </section>
  );
}

export function ProviderProfile({ provider }: { provider: ProviderDetail }) {
  return (
    <article className="pb-8">
      {provider.photos.length > 0 && (
        <Image
          src={provider.photos[0].image}
          alt={provider.photos[0].caption || `The workshop at ${provider.name}`}
          width={1024}
          height={432}
          className="aspect-video w-full object-cover lg:aspect-[21/9] lg:rounded-lg"
          priority
          sizes="(max-width: 1024px) 100vw, 1024px"
        />
      )}

      <div className="px-3 pt-3 lg:px-6 lg:pt-5">
        <h1 className="text-xl font-bold leading-tight lg:text-3xl">{provider.name}</h1>
        <p className="mt-1 text-sm text-[var(--color-muted-foreground)]">
          {provider.address ? `${provider.address}, ` : ""}
          {provider.area}
        </p>
      </div>

      <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_22rem] lg:gap-8 lg:px-6">
        <aside className="lg:order-2">
          <div className="lg:sticky lg:top-4">
            <VerificationBlock provider={provider} />
            <GovernmentBlock provider={provider} />
          </div>
        </aside>

        <Programmes provider={provider} />
      </div>

      {provider.is_stale && (
        <p className="mx-3 mt-4 rounded-lg border border-[var(--color-warn)]/20 bg-[var(--color-warn-bg)] p-3 text-xs text-[var(--color-warn)] lg:mx-6">
          These details were last confirmed with the provider some time ago. Confirm the fee
          before you travel.
        </p>
      )}
    </article>
  );
}
