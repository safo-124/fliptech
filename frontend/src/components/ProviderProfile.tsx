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
  Flag,
  GraduationCap,
  Info,
  MapPin,
  Navigation,
  ShieldCheck,
  Wrench,
} from "lucide-react";
import { useTranslations } from "next-intl";

import { ProviderLocationMap } from "@/components/ProviderLocationMap";
import { VideoLesson } from "@/components/VideoLesson";
import { SaveProviderButton } from "@/components/trainee/SaveProviderButton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { ClientMessages } from "@/i18n/ClientMessages";
import { PROFILE_CLIENT_NAMESPACES } from "@/i18n/namespaces";
import { BRAND } from "@/lib/brand";
import { directionsUrl, hasPin } from "@/lib/directions";
import { formatDate, formatDuration, formatFee } from "@/lib/format";
import type { ProviderDetail } from "@/lib/types";

/**
 * A government status worded from its code, so it can be translated. A code
 * this build does not know falls back to the label as the backend wrote it.
 */
function governmentStatus(
  t: ReturnType<typeof useTranslations<"ProviderProfile">>,
  code: string,
  label: string,
) {
  const key = `status.${code}`;
  return t.has(key as "status.registered") ? t(key as "status.registered") : label;
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] gap-4 border-b border-[var(--color-border)] py-3 last:border-0">
      <dt className="text-sm leading-5 text-[var(--color-muted-foreground)]">{label}</dt>
      <dd className="break-words text-right text-sm font-semibold leading-5">{value}</dd>
    </div>
  );
}

function VerificationBlock({ provider }: { provider: ProviderDetail }) {
  const t = useTranslations("ProviderProfile");
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
                  {t("siteVisited")}
                </>
              ) : (
                t("notVisited")
              )}
            </Badge>
          </div>
          <h2 id="fliptech-verification-heading" className="mt-4 text-base font-bold">
            {t("verificationHeading", { brand: BRAND })}
          </h2>
          {latestVisit ? (
            <>
              <p className="mt-2 text-sm leading-6">{latestVisit.checks_performed}</p>
              <p className="mt-3 flex items-start gap-2 text-xs leading-5 text-[var(--color-muted-foreground)]">
                <CalendarDays className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
                <span>
                  {latestVisit.officer
                    ? t("visitedOnBy", {
                        date: formatDate(latestVisit.visited_on),
                        officer: latestVisit.officer,
                      })
                    : t("visitedOn", { date: formatDate(latestVisit.visited_on) })}
                </span>
              </p>
            </>
          ) : (
            <p className="mt-2 text-sm leading-6 text-[var(--color-muted-foreground)]">
              {t("notVisitedBody", { brand: BRAND })}
            </p>
          )}

          <div className="mt-4 flex gap-2.5 rounded-xl border border-[var(--color-border)] bg-[var(--color-muted)]/70 p-3 text-xs leading-5 text-[var(--color-muted-foreground)]">
            <Info className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <p>
              {t("notAccreditation", { brand: BRAND })}
            </p>
          </div>
        </CardContent>
      </section>
    </Card>
  );
}

function GovernmentBlock({ provider }: { provider: ProviderDetail }) {
  const t = useTranslations("ProviderProfile");
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
              {government ? t("documentRecord") : t("noRecordClaimed")}
            </Badge>
          </div>
          <h2 id="government-status-heading" className="mt-4 text-base font-bold">
            {t("governmentHeading")}
          </h2>
          <dl className="mt-2">
            <Row
              label={t("ctvetRegistration")}
              value={
                government
                  ? governmentStatus(t, government.registration_status, government.registration_status_display)
                  : t("notClaimed")
              }
            />
            {government?.registration_number ? (
              <Row label={t("registrationNumber")} value={government.registration_number} />
            ) : null}
            <Row
              label={t("accreditation")}
              value={
                government
                  ? governmentStatus(t, government.accreditation_status, government.accreditation_status_display)
                  : t("notClaimed")
              }
            />
            {government?.source_note ? (
              <Row label={t("source")} value={government.source_note} />
            ) : null}
          </dl>
          <p className="mt-3 flex gap-2 text-xs leading-5 text-[var(--color-muted-foreground)]">
            <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
            <span>{t("shownAsDocumented", { brand: BRAND })}</span>
          </p>
        </CardContent>
      </section>
    </Card>
  );
}

function Programmes({ provider }: { provider: ProviderDetail }) {
  const t = useTranslations("ProviderProfile");
  const tFormat = useTranslations("Format");
  return (
    <section aria-labelledby="training-offered-heading" className="lg:order-1">
      <div className="flex items-end justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--color-brand-strong)]">
            {t("courseOptions")}
          </p>
          <h2 id="training-offered-heading" className="mt-1 text-2xl font-bold tracking-tight">
            {t("trainingOffered")}
          </h2>
        </div>
        <Badge variant="outline">{t("courseCount", { count: provider.programmes.length })}</Badge>
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
                          {t("courseFee")}
                        </p>
                        <p className="mt-1 text-xl font-bold tabular-nums">
                          {formatFee(programme.fee, tFormat)}
                        </p>
                      </div>
                    </div>

                    <dl className="mt-5 grid gap-3 sm:grid-cols-3">
                      <div className="rounded-xl bg-[var(--color-muted)]/70 p-3">
                        <dt className="flex items-center gap-2 text-xs font-medium text-[var(--color-muted-foreground)]">
                          <Clock3 className="size-3.5 text-[var(--color-brand)]" aria-hidden="true" />
                          {t("duration")}
                        </dt>
                        <dd className="mt-1.5 text-sm font-semibold">
                          {formatDuration(programme.duration_weeks, tFormat)}
                        </dd>
                      </div>
                      <div className="rounded-xl bg-[var(--color-muted)]/70 p-3">
                        <dt className="flex items-center gap-2 text-xs font-medium text-[var(--color-muted-foreground)]">
                          <CalendarDays className="size-3.5 text-[var(--color-brand)]" aria-hidden="true" />
                          {t("nextIntake")}
                        </dt>
                        <dd className="mt-1.5 text-sm font-semibold">
                          {nextIntake ? formatDate(nextIntake.start_date) : t("askProvider")}
                        </dd>
                      </div>
                      <div className="rounded-xl bg-[var(--color-muted)]/70 p-3">
                        <dt className="flex items-center gap-2 text-xs font-medium text-[var(--color-muted-foreground)]">
                          <Banknote className="size-3.5 text-[var(--color-brand)]" aria-hidden="true" />
                          {t("payment")}
                        </dt>
                        <dd className="mt-1.5 text-sm font-semibold">
                          {programme.instalments_allowed ? t("instalmentsAllowed") : t("fullPayment")}
                        </dd>
                      </div>
                    </dl>

                    {/* A plain list, not prose. */}
                    <dl className="mt-4 rounded-xl border border-[var(--color-border)] px-4">
                      <Row
                        label={t("instalmentDetails")}
                        value={
                          programme.instalments_allowed
                            ? programme.instalment_note || t("allowed")
                            : t("fullPayment")
                        }
                      />
                      {programme.hours_per_week ? (
                        <Row label={t("hoursAWeek")} value={`${programme.hours_per_week}`} />
                      ) : null}
                      {programme.weekly_schedule ? (
                        <Row label={t("schedule")} value={programme.weekly_schedule} />
                      ) : null}
                      {nextIntake && nextIntake.places_remaining !== null ? (
                        <Row label={t("placesRemaining")} value={`${nextIntake.places_remaining}`} />
                      ) : null}
                    </dl>
                  </div>

                  <Separator />

                  <div className="flex flex-col gap-3 bg-[var(--color-background)]/70 p-5 sm:flex-row sm:items-center sm:justify-between sm:px-6">
                    <p className="max-w-sm text-xs leading-5 text-[var(--color-muted-foreground)]">
                      {t("askAbout")}
                    </p>
                    <Button asChild variant="brand" className="w-full sm:w-auto">
                      <Link
                        href={`/enquiry?programme=${programme.id}${nextIntake ? `&intake=${nextIntake.id}` : ""}`}
                      >
                        {t("enquire")}
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
            <h3 className="mt-3 font-bold">{t("noCoursesTitle")}</h3>
            <p className="mt-1 text-sm text-[var(--color-muted-foreground)]">
              {t("noCoursesBody")}
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
/**
 * Where the workshop is. Someone choosing between two of them is also
 * choosing a journey, and the address alone does not find a workshop in
 * Accra. The landmark would, but it is not shown: trainers were told it is
 * how the field officer finds them, not that it would be public.
 */
function Location({ provider }: { provider: ProviderDetail }) {
  const t = useTranslations("ProviderProfile");
  if (!hasPin(provider)) return null;

  return (
    <section aria-labelledby="location-heading" className="lg:order-1">
      <h2 id="location-heading" className="text-2xl font-bold tracking-tight">
        {t("locationHeading")}
      </h2>
      <p className="mt-1 text-sm leading-6 text-[var(--color-muted-foreground)]">
        {provider.address ? `${provider.address}, ` : ""}
        {provider.area}
      </p>

      <div className="mt-4 overflow-hidden rounded-2xl border border-[var(--color-border)]">
        <ProviderLocationMap
          place={{
            lat: provider.lat,
            lng: provider.lng,
            primary_photo: provider.primary_photo,
            logo: provider.logo,
          }}
          label={t("locationMapLabel", { name: provider.name })}
        />
      </div>

      <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-xs leading-5 text-[var(--color-muted-foreground)]">{t("locationNote")}</p>
        <Button asChild variant="outline" className="w-full shrink-0 sm:w-auto">
          <a
            href={directionsUrl(provider.lat, provider.lng)}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={t("directionsLabel", { name: provider.name })}
          >
            <Navigation aria-hidden="true" />
            {t("directions")}
          </a>
        </Button>
      </div>
    </section>
  );
}

/**
 * The workshop teaching, on video. Only ones staff have watched reach here.
 *
 * Straight after the courses, because it answers the question the courses
 * raise: a fee and a duration say what is on offer, and a minute of the
 * trainer at work says whether they can actually teach it.
 */
function Videos({ provider }: { provider: ProviderDetail }) {
  const t = useTranslations("ProviderProfile");
  if (provider.videos.length === 0) return null;

  return (
    <section aria-labelledby="videos-heading" className="lg:order-1">
      <h2 id="videos-heading" className="text-2xl font-bold tracking-tight">
        {t("videosTitle")}
      </h2>
      <p className="mt-1 text-sm leading-6 text-[var(--color-muted-foreground)]">
        {t("videosCaption", { brand: BRAND })}
      </p>

      <ul className="mt-4 grid gap-5 sm:grid-cols-2">
        {provider.videos.map((video) => (
          <li key={video.id}>
            <VideoLesson
              youtubeId={video.youtube_id}
              title={video.title}
              playLabel={t("playVideo", { title: video.title })}
            />
            <p className="mt-2 text-sm font-semibold leading-5">{video.title}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}

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
  const t = useTranslations("ProviderProfile");
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
            alt={heroPhoto.caption || t("heroAlt", { name: provider.name })}
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
              <p className="mt-3 text-sm font-medium">{t("photoComingSoon")}</p>
            </div>
          </div>
        )}

        {provider.photos.length > 1 ? (
          <Badge className="absolute bottom-3 right-3 border-white/30 bg-black/70 text-white sm:bottom-5 sm:right-5">
            <Camera aria-hidden="true" />
            {t("photoCount", { count: provider.photos.length })}
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
                  alt={t("logoAlt", { name: provider.name })}
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
              <span>
                {provider.address ? `${provider.address}, ` : ""}
                {provider.area}
                {hasPin(provider) ? (
                  <>
                    {" · "}
                    <a
                      href={directionsUrl(provider.lat, provider.lng)}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label={t("directionsLabel", { name: provider.name })}
                      className="font-semibold text-[var(--color-brand-strong)] underline underline-offset-4"
                    >
                      {t("directions")}
                    </a>
                  </>
                ) : null}
              </span>
            </p>
          </div>

          <div className="flex shrink-0 flex-wrap items-center gap-3">
          <ClientMessages namespaces={PROFILE_CLIENT_NAMESPACES}>
            <SaveProviderButton
              providerId={provider.id}
              returnTo={`/${provider.area_slug}/${provider.slug}`}
            />
          </ClientMessages>
          <div className="flex shrink-0 items-center gap-2 rounded-2xl border border-[var(--color-border)] bg-[var(--color-background)] px-4 py-3">
            <GraduationCap className="size-5 text-[var(--color-brand)]" aria-hidden="true" />
            <div>
              <p className="text-xs text-[var(--color-muted-foreground)]">{t("trainingChoices")}</p>
              <p className="text-sm font-bold">
                {t("courseCount", { count: provider.programmes.length })}
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

          <Videos provider={provider} />

          <Location provider={provider} />

          <PhotoStrip
            photos={workPhotos}
            title={t("theirWork")}
            caption={t("theirWorkCaption")}
            headingId="their-work-heading"
          />

          {/* The hero already shows one, so this only earns its place when
              there are others. */}
          {workshopPhotos.length > 1 ? (
            <PhotoStrip
              photos={workshopPhotos.slice(1)}
              title={t("theWorkshop")}
              caption={t("theWorkshopCaption")}
              headingId="the-workshop-heading"
            />
          ) : null}
        </div>
      </div>

      {provider.is_stale && (
        <div className="px-5 pb-7 sm:px-7 sm:pb-9 lg:px-10 lg:pb-10">
          <Alert variant="warning">
            <AlertTriangle aria-hidden="true" />
            <AlertTitle>{t("staleTitle")}</AlertTitle>
            <AlertDescription>{t("staleBody")}</AlertDescription>
          </Alert>
        </div>
      )}

      {/* Quiet, but on every listing: a complaint is how a bad workshop is
          found, and the person who has one should not have to hunt. */}
      <div className="border-t border-[var(--color-border)] px-5 py-4 sm:px-7 lg:px-10">
        <Link
          href={`/${provider.area_slug}/${provider.slug}/report`}
          className="inline-flex min-h-11 items-center gap-2 text-sm text-[var(--color-muted-foreground)] underline-offset-4 hover:text-[var(--color-foreground)] hover:underline"
        >
          <Flag className="size-4" aria-hidden="true" />
          {t("reportProblem")}
        </Link>
      </div>
    </article>
  );
}
