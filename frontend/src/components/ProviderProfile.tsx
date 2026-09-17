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
import {
  AlertTriangle,
  ArrowRight,
  BadgeCheck,
  Banknote,
  Building2,
  CalendarDays,
  Camera,
  Clock3,
  FileCheck2,
  Info,
  MapPin,
  ShieldCheck,
  Sparkles,
  Wrench,
} from "lucide-react";

import { SaveProviderButton } from "@/components/trainee/SaveProviderButton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { BRAND } from "@/lib/brand";
import { formatDate, formatDuration, formatFee } from "@/lib/format";
import type { ProviderDetail } from "@/lib/types";

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] gap-4 border-b border-[var(--color-border)] py-3 last:border-0">
      <dt className="text-sm leading-5 text-[var(--color-muted-foreground)]">{label}</dt>
      <dd className="break-words text-right text-sm font-semibold leading-5">{value}</dd>
    </div>
  );
}

function VerificationBlock({ provider }: { provider: ProviderDetail }) {
  const latestVisit = provider.verifications[0] ?? null;

  return (
    <Card>
      <section aria-labelledby="fliptech-verification-heading">
        <CardContent className="p-5">
          <div className="flex items-start justify-between gap-3">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-[var(--color-visit-bg)] text-[var(--color-visit)]">
              <ShieldCheck className="size-5" aria-hidden="true" />
            </div>
            <Badge variant={latestVisit ? "visit" : "warning"}>
              {latestVisit ? (
                <>
                  <BadgeCheck aria-hidden="true" />
                  Site visited
                </>
              ) : (
                "Not visited"
              )}
            </Badge>
          </div>
          <h2 id="fliptech-verification-heading" className="mt-4 text-base font-bold">
            {BRAND} verification
          </h2>
          {latestVisit ? (
            <>
              <p className="mt-2 text-sm leading-6">{latestVisit.checks_performed}</p>
              <p className="mt-3 flex items-start gap-2 text-xs leading-5 text-[var(--color-muted-foreground)]">
                <CalendarDays className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
                <span>
                  Visited {formatDate(latestVisit.visited_on)}
                  {latestVisit.officer ? ` by ${latestVisit.officer}` : ""}.
                </span>
              </p>
            </>
          ) : (
            <p className="mt-2 text-sm leading-6 text-[var(--color-muted-foreground)]">
              {BRAND} has not visited this workshop. Everything below was supplied by the
              provider and has not been checked by us.
            </p>
          )}

          <div className="mt-4 flex gap-2.5 rounded-xl border border-[var(--color-border)] bg-[var(--color-muted)]/70 p-3 text-xs leading-5 text-[var(--color-muted-foreground)]">
            <Info className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <p>
              A {BRAND} visit is not a government accreditation. It records what our officer
              saw on the day.
            </p>
          </div>
        </CardContent>
      </section>
    </Card>
  );
}

function GovernmentBlock({ provider }: { provider: ProviderDetail }) {
  const government = provider.government_status_detail;

  return (
    <Card>
      <section aria-labelledby="government-status-heading">
        <CardContent className="p-5">
          <div className="flex items-start justify-between gap-3">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-[var(--color-gov-bg)] text-[var(--color-gov)]">
              <Building2 className="size-5" aria-hidden="true" />
            </div>
            <Badge variant={government ? "government" : "secondary"}>
              <FileCheck2 aria-hidden="true" />
              {government ? "Document record" : "No record claimed"}
            </Badge>
          </div>
          <h2 id="government-status-heading" className="mt-4 text-base font-bold">
            Government status
          </h2>
          <dl className="mt-2">
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
            {government?.source_note ? (
              <Row label="Source" value={government.source_note} />
            ) : null}
          </dl>
          <p className="mt-3 flex gap-2 text-xs leading-5 text-[var(--color-muted-foreground)]">
            <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
            <span>Shown exactly as documented. {BRAND} does not infer this status.</span>
          </p>
        </CardContent>
      </section>
    </Card>
  );
}

function Programmes({ provider }: { provider: ProviderDetail }) {
  return (
    <section aria-labelledby="training-offered-heading" className="lg:order-1">
      <div className="flex items-end justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--color-brand-strong)]">
            Course options
          </p>
          <h2 id="training-offered-heading" className="mt-1 text-2xl font-bold tracking-tight">
            Training offered
          </h2>
        </div>
        <Badge variant="outline">
          {provider.programmes.length} {provider.programmes.length === 1 ? "course" : "courses"}
        </Badge>
      </div>

      {provider.programmes.length > 0 ? (
        <div className="mt-5 space-y-4">
          {provider.programmes.map((programme) => {
            const nextIntake = programme.intakes[0] ?? null;
            return (
              <Card key={programme.id} className="overflow-hidden">
                <CardContent className="p-0">
                  <div className="p-5 sm:p-6">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div>
                        <Badge variant="secondary">{programme.trade}</Badge>
                        <h3 className="mt-3 text-xl font-bold tracking-tight">
                          {programme.title}
                        </h3>
                      </div>
                      <div className="sm:text-right">
                        <p className="text-xs font-medium text-[var(--color-muted-foreground)]">
                          Course fee
                        </p>
                        <p className="mt-1 text-xl font-bold tabular-nums">
                          {formatFee(programme.fee)}
                        </p>
                      </div>
                    </div>

                    <dl className="mt-5 grid gap-3 sm:grid-cols-3">
                      <div className="rounded-xl bg-[var(--color-muted)]/70 p-3">
                        <dt className="flex items-center gap-2 text-xs font-medium text-[var(--color-muted-foreground)]">
                          <Clock3 className="size-3.5 text-[var(--color-brand)]" aria-hidden="true" />
                          Duration
                        </dt>
                        <dd className="mt-1.5 text-sm font-semibold">
                          {formatDuration(programme.duration_weeks)}
                        </dd>
                      </div>
                      <div className="rounded-xl bg-[var(--color-muted)]/70 p-3">
                        <dt className="flex items-center gap-2 text-xs font-medium text-[var(--color-muted-foreground)]">
                          <CalendarDays className="size-3.5 text-[var(--color-brand)]" aria-hidden="true" />
                          Next intake
                        </dt>
                        <dd className="mt-1.5 text-sm font-semibold">
                          {nextIntake ? formatDate(nextIntake.start_date) : "Ask the provider"}
                        </dd>
                      </div>
                      <div className="rounded-xl bg-[var(--color-muted)]/70 p-3">
                        <dt className="flex items-center gap-2 text-xs font-medium text-[var(--color-muted-foreground)]">
                          <Banknote className="size-3.5 text-[var(--color-brand)]" aria-hidden="true" />
                          Payment
                        </dt>
                        <dd className="mt-1.5 text-sm font-semibold">
                          {programme.instalments_allowed ? "Instalments allowed" : "Full payment"}
                        </dd>
                      </div>
                    </dl>

                    {/* A plain list, not prose. */}
                    <dl className="mt-4 rounded-xl border border-[var(--color-border)] px-4">
                      <Row
                        label="Instalment details"
                        value={
                          programme.instalments_allowed
                            ? programme.instalment_note || "Allowed"
                            : "Full payment"
                        }
                      />
                      {programme.hours_per_week ? (
                        <Row label="Hours a week" value={`${programme.hours_per_week}`} />
                      ) : null}
                      {programme.weekly_schedule ? (
                        <Row label="Schedule" value={programme.weekly_schedule} />
                      ) : null}
                      {nextIntake && nextIntake.places_remaining !== null ? (
                        <Row label="Places remaining" value={`${nextIntake.places_remaining}`} />
                      ) : null}
                    </dl>
                  </div>

                  <Separator />

                  <div className="flex flex-col gap-3 bg-[var(--color-background)]/70 p-5 sm:flex-row sm:items-center sm:justify-between sm:px-6">
                    <p className="max-w-sm text-xs leading-5 text-[var(--color-muted-foreground)]">
                      Ask about availability, entry requirements or payment options.
                    </p>
                    <Button asChild variant="brand" className="w-full sm:w-auto">
                      <Link
                        href={`/enquiry?programme=${programme.id}${nextIntake ? `&intake=${nextIntake.id}` : ""}`}
                      >
                        Enquire about this course
                        <ArrowRight aria-hidden="true" />
                      </Link>
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      ) : (
        <Card className="mt-5 border-dashed text-center">
          <CardContent className="px-5 py-10">
            <Wrench className="mx-auto size-7 text-[var(--color-muted-foreground)]" aria-hidden="true" />
            <h3 className="mt-3 font-bold">Course details coming soon</h3>
            <p className="mt-1 text-sm text-[var(--color-muted-foreground)]">
              This provider has not published any training courses yet.
            </p>
          </CardContent>
        </Card>
      )}
    </section>
  );
}

/**
 * A row of photographs of one kind.
 *
 * The work gets its own heading rather than being mixed into a single gallery.
 * "Is this a real place" and "is the work any good" are different questions,
 * and a trainee deciding whether a fee is worth paying is asking the second
 * one — which a picture of a tidy yard does not answer.
 */
function PhotoStrip({
  photos,
  title,
  caption,
  headingId,
}: {
  photos: ProviderDetail["photos"];
  title: string;
  caption: string;
  headingId: string;
}) {
  if (photos.length === 0) return null;

  return (
    <section aria-labelledby={headingId} className="lg:order-1">
      <h2 id={headingId} className="text-2xl font-bold tracking-tight">
        {title}
      </h2>
      <p className="mt-1 text-sm leading-6 text-[var(--color-muted-foreground)]">{caption}</p>

      <ul className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
        {photos.map((photo) => (
          <li key={photo.id}>
            <Image
              src={photo.image}
              alt={photo.caption || title}
              width={520}
              height={390}
              className="aspect-4/3 w-full rounded-xl border border-[var(--color-border)] object-cover"
              // Below the fold, and prepaid data is a real cost to this user.
              loading="lazy"
              sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 260px"
            />
            {photo.caption ? (
              <p className="mt-1.5 text-xs leading-5 text-[var(--color-muted-foreground)]">
                {photo.caption}
              </p>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}

export function ProviderProfile({ provider }: { provider: ProviderDetail }) {
  // The hero should show the place, not a close-up of a gate: someone landing
  // here is still deciding whether this is a real workshop they can get to.
  // Falls back to whatever exists when there is no premises shot.
  const workshopPhotos = provider.photos.filter((photo) => photo.kind === "workshop");
  const workPhotos = provider.photos.filter((photo) => photo.kind === "work");
  const heroPhoto = workshopPhotos[0] ?? provider.photos[0] ?? null;

  return (
    <article>
      <div className="relative overflow-hidden bg-[var(--color-muted)]">
        {heroPhoto ? (
          <Image
            src={heroPhoto.image}
            alt={heroPhoto.caption || `The workshop at ${provider.name}`}
            width={1400}
            height={620}
            className="aspect-[4/3] w-full object-cover sm:aspect-video lg:aspect-[21/8]"
            priority
            sizes="(max-width: 1024px) 100vw, 1400px"
          />
        ) : (
          <div className="surface-grid flex aspect-[4/3] w-full items-center justify-center sm:aspect-video lg:aspect-[21/8]">
            <div className="flex flex-col items-center text-[var(--color-muted-foreground)]">
              <div className="flex size-16 items-center justify-center rounded-2xl bg-[var(--color-card)] shadow-sm">
                <Wrench className="size-7" aria-hidden="true" />
              </div>
              <p className="mt-3 text-sm font-medium">Workshop photo coming soon</p>
            </div>
          </div>
        )}

        {provider.photos.length > 1 ? (
          <Badge className="absolute bottom-3 right-3 border-white/30 bg-black/70 text-white sm:bottom-5 sm:right-5">
            <Camera aria-hidden="true" />
            {provider.photos.length} photos
          </Badge>
        ) : null}
      </div>

      <header className="border-b border-[var(--color-border)] px-5 py-6 sm:px-7 sm:py-8 lg:px-10">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
          <div className="min-w-0">
            <Badge variant="secondary">
              <MapPin aria-hidden="true" />
              {provider.area}, {provider.region}
            </Badge>
            <div className="mt-3 flex items-start gap-4">
              {provider.logo ? (
                /* object-contain, not cover: a logo cropped to fill is a logo
                   nobody recognises. White behind it because most are drawn for
                   a light background. */
                <Image
                  src={provider.logo}
                  alt={`${provider.name} logo`}
                  width={72}
                  height={72}
                  className="size-16 shrink-0 rounded-2xl border border-[var(--color-border)] bg-white object-contain p-1.5 sm:size-[4.5rem]"
                  sizes="72px"
                />
              ) : null}
              <h1 className="max-w-3xl text-3xl font-bold leading-tight tracking-[-0.04em] sm:text-4xl lg:text-5xl">
                {provider.name}
              </h1>
            </div>
            <p className="mt-3 flex max-w-2xl items-start gap-2 text-sm leading-6 text-[var(--color-muted-foreground)] sm:text-base">
              <MapPin className="mt-1 size-4 shrink-0" aria-hidden="true" />
              <span>{provider.address ? `${provider.address}, ` : ""}{provider.area}</span>
            </p>
          </div>

          <div className="flex shrink-0 flex-wrap items-center gap-3">
          <SaveProviderButton
            providerId={provider.id}
            returnTo={`/${provider.area_slug}/${provider.slug}`}
          />
          <div className="flex shrink-0 items-center gap-2 rounded-2xl border border-[var(--color-border)] bg-[var(--color-background)] px-4 py-3">
            <Sparkles className="size-5 text-[var(--color-brand)]" aria-hidden="true" />
            <div>
              <p className="text-xs text-[var(--color-muted-foreground)]">Training choices</p>
              <p className="text-sm font-bold">
                {provider.programmes.length} {provider.programmes.length === 1 ? "course" : "courses"}
              </p>
            </div>
          </div>
          </div>
        </div>
      </header>

      <div className="grid gap-7 px-5 py-7 sm:px-7 sm:py-9 lg:grid-cols-[minmax(0,1fr)_22rem] lg:gap-10 lg:px-10 lg:py-10">
        <aside className="space-y-4 lg:order-2">
          <div className="space-y-4 lg:sticky lg:top-28">
            <VerificationBlock provider={provider} />
            <GovernmentBlock provider={provider} />
          </div>
        </aside>

        <div className="space-y-9 lg:order-1">
          <Programmes provider={provider} />

          <PhotoStrip
            photos={workPhotos}
            title="Their work"
            caption="Made or repaired by this workshop and its trainees."
            headingId="their-work-heading"
          />

          {/* The hero already shows one, so this only earns its place when
              there are others. */}
          {workshopPhotos.length > 1 ? (
            <PhotoStrip
              photos={workshopPhotos.slice(1)}
              title="The workshop"
              caption="Where the training happens."
              headingId="the-workshop-heading"
            />
          ) : null}
        </div>
      </div>

      {provider.is_stale && (
        <div className="px-5 pb-7 sm:px-7 sm:pb-9 lg:px-10 lg:pb-10">
          <Alert variant="warning">
            <AlertTriangle aria-hidden="true" />
            <AlertTitle>Confirm before you travel</AlertTitle>
            <AlertDescription>
              These details were last confirmed with the provider some time ago. Confirm the
              fee before you travel.
            </AlertDescription>
          </Alert>
        </div>
      )}
    </article>
  );
}
