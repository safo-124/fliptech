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
  Banknote,
  Building2,
  CalendarDays,
  Camera,
  Clock3,
  DoorOpen,
  Flag,
  GraduationCap,
  Info,
  MapPin,
  Navigation,
  ReceiptText,
  ShieldCheck,
  Signal,
  Wrench,
} from "lucide-react";
import { useLocale, useTranslations } from "next-intl";

import { BeforeAfter } from "@/components/BeforeAfter";
import { ListenButton } from "@/components/ListenButton";
import { ProviderLocationMap } from "@/components/ProviderLocationMap";
import { Stamp, initialsOf } from "@/components/Stamp";
import { TradeChip } from "@/components/TradeChip";
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
import { isTeachingLanguage } from "@/lib/teaching-languages";
import type { Programme, ProviderDetail } from "@/lib/types";

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

/** The site visit as a stamp: visited, when and by whom, or an empty outline. */
function VisitStamp({ provider, className }: { provider: ProviderDetail; className?: string }) {
  const t = useTranslations("ProviderProfile");
  const latestVisit = provider.verifications[0] ?? null;
  if (!latestVisit) {
    return <Stamp tone="muted" empty lines={[t("stampNotVisited")]} className={className} />;
  }
  return (
    <Stamp
      tone="visit"
      className={className}
      lines={[
        t("stampVisited"),
        formatDate(latestVisit.visited_on),
        ...(latestVisit.officer
          ? [t("stampOfficer", { initials: initialsOf(latestVisit.officer) })]
          : []),
      ]}
    />
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
            <VisitStamp provider={provider} />
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
            {government ? (
              <Stamp tone="gov" lines={[t("stampOnRecord"), t("documentRecord")]} />
            ) : (
              <Stamp tone="muted" empty lines={[t("stampNotClaimed")]} />
            )}
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

const RECEIPT_TONE = {
  plain: "text-[var(--color-foreground)]",
  included: "text-[var(--color-visit)]",
  extra: "text-[var(--color-warn)]",
} as const;

/** One line of the receipt. Green only for what the fee covers; amber for what it does not. */
function ReceiptRow({
  label,
  value,
  tone = "plain",
}: {
  label: string;
  value: string;
  tone?: keyof typeof RECEIPT_TONE;
}) {
  return (
    <div className="flex items-baseline gap-2 py-1.5">
      <dt className="min-w-0">{label}</dt>
      {/* Dotted leader, as on a printed receipt. */}
      <span aria-hidden="true" className="min-w-4 flex-1 translate-y-[-3px] border-b border-dotted border-[var(--color-border-strong)]" />
      <dd className={`shrink-0 font-semibold tabular-nums ${RECEIPT_TONE[tone]}`}>
        {value}
      </dd>
    </div>
  );
}

/**
 * What a course really costs, laid out like a receipt.
 *
 * Hidden costs are the commonest complaint about apprenticeships: a fee that
 * looks cheaper until the trainee is told to buy their own tools and
 * materials. So each thing the fee might cover is a line marked included or
 * extra, the workshop's estimate for the extras is a line of its own, and the
 * bottom line is a total to plan for — or, without an estimate, says plainly
 * that the extras still have to be asked about.
 */
function FeeReceipt({ programme }: { programme: Programme }) {
  const t = useTranslations("ProviderProfile");
  const tFormat = useTranslations("Format");
  const covered = [
    ["tools", programme.fee_includes_tools],
    ["materials", programme.fee_includes_materials],
    ["ppe", programme.fee_includes_ppe],
  ] as const;
  const certificateExtra = Boolean(programme.certificate_awarded) && !programme.fee_includes_certificate;
  const anythingExtra = covered.some(([, included]) => !included) || certificateExtra;
  const extraCosts = programme.extra_costs ? Number(programme.extra_costs) : null;
  const total = extraCosts !== null ? (Number(programme.fee) + extraCosts).toFixed(2) : null;

  return (
    <div className="mt-4 rounded-xl border border-[var(--color-border)] bg-[var(--color-card)] px-4 pb-3 pt-3.5">
      <p className="flex items-center gap-2 text-sm font-bold">
        <ReceiptText className="size-4 text-[var(--color-brand)]" aria-hidden="true" />
        {t("receiptTitle")}
      </p>
      <dl className="mt-1.5 text-sm">
        <ReceiptRow label={t("receiptFee")} value={formatFee(programme.fee, tFormat)} />
        {covered.map(([key, included]) => (
          <ReceiptRow
            key={key}
            label={t(`receiptItems.${key}`)}
            value={included ? t("included") : t("extra")}
            tone={included ? "included" : "extra"}
          />
        ))}
        <ReceiptRow
          label={programme.certificate_awarded || t("receiptItems.certificate")}
          value={
            !programme.certificate_awarded
              ? t("noneAwarded")
              : programme.fee_includes_certificate
                ? t("included")
                : t("extra")
          }
          tone={
            !programme.certificate_awarded
              ? "plain"
              : programme.fee_includes_certificate
                ? "included"
                : "extra"
          }
        />
        {extraCosts !== null ? (
          <ReceiptRow
            label={programme.extra_costs_note || t("receiptItems.otherCosts")}
            value={t("about", { amount: formatFee(programme.extra_costs, tFormat) })}
            tone="extra"
          />
        ) : null}
      </dl>
      {/* The tear line. */}
      <div className="mt-2 flex items-baseline justify-between gap-3 border-t-2 border-dashed border-[var(--color-border-strong)] pt-2.5 text-base font-bold">
        <span>
          {total !== null ? t("planFor") : anythingExtra ? t("feePlusExtras") : t("allIncluded")}
        </span>
        <span className="tabular-nums">{formatFee(total ?? programme.fee, tFormat)}</span>
      </div>
      {total === null && anythingExtra ? (
        <p className="mt-1.5 text-xs leading-5 text-[var(--color-muted-foreground)]">
          {t("askAboutExtras")}
        </p>
      ) : null}
    </div>
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
                        <TradeChip name={programme.trade} colour={programme.trade_colour} />
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

                    <FeeReceipt programme={programme} />

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
 * The master or madam who teaches: portrait, years in the trade, apprentices
 * trained and the languages the teaching is done in.
 *
 * In Ghanaian apprenticeship a trainee chooses the master as much as the
 * shop, so this leads the listing's main column. Everything here was given by
 * the workshop as public; nothing shows that it left blank.
 */
function MasterStrip({ provider }: { provider: ProviderDetail }) {
  const t = useTranslations("ProviderProfile");
  const tLanguage = useTranslations("TeachingLanguages");
  const master = provider.master;
  if (!master) return null;

  const name = master.name || t("theMaster");
  const facts = [
    master.years_in_trade !== null ? t("yearsInTrade", { count: master.years_in_trade }) : null,
    master.apprentices_trained !== null
      ? t("apprenticesTrained", { count: master.apprentices_trained })
      : null,
  ].filter((fact): fact is string => fact !== null);
  const languages = master.languages.filter(isTeachingLanguage);

  return (
    <section
      aria-labelledby="master-heading"
      className="flex items-center gap-4 rounded-2xl border border-[var(--color-border)] bg-[var(--color-card)] p-4 sm:gap-5 sm:p-5 lg:order-1"
    >
      {master.portrait ? (
        <Image
          src={master.portrait}
          alt={t("portraitAlt", { name })}
          width={96}
          height={96}
          sizes="96px"
          className="size-20 shrink-0 rounded-full object-cover ring-4 ring-[var(--color-brand-soft)] sm:size-24"
        />
      ) : (
        <div
          aria-hidden="true"
          className="grid size-20 shrink-0 place-items-center rounded-full bg-[var(--color-brand-soft)] text-2xl font-bold text-[var(--color-brand-strong)] sm:size-24"
        >
          {initialsOf(name).replaceAll(".", "") || <GraduationCap className="size-8" />}
        </div>
      )}
      <div className="min-w-0">
        <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--color-brand-strong)]">
          {t("whoTeaches")}
        </p>
        <h2 id="master-heading" className="mt-0.5 break-words text-xl font-bold tracking-tight">
          {name}
        </h2>
        {facts.length ? (
          <p className="mt-1 text-sm text-[var(--color-muted-foreground)]">{facts.join(" · ")}</p>
        ) : null}
        {languages.length ? (
          <p className="mt-2 flex flex-wrap items-center gap-1.5 text-xs">
            <span className="text-[var(--color-muted-foreground)]">{t("teachesIn")}</span>
            {languages.map((code) => (
              <span key={code} className="badge bg-[var(--color-background)] font-semibold">
                {tLanguage(code)}
              </span>
            ))}
          </p>
        ) : null}
      </div>
    </section>
  );
}

/**
 * "Find the gate": the workshop's own directions in large type, and a photo
 * of the way in, ahead of the map.
 *
 * People here navigate by landmarks — "opposite the lorry station, blue gate"
 * — far more than by street addresses, and a pin can be a street out. The
 * directions are written by the workshop for the public, never the private
 * landmark: see Provider.directions.
 */
function FindTheGate({ provider }: { provider: ProviderDetail }) {
  const t = useTranslations("ProviderProfile");
  if (!provider.directions && !provider.entrance_photo) return null;

  return (
    <div className="mt-4 overflow-hidden rounded-2xl border border-[var(--color-border)] bg-[var(--color-card)] sm:flex">
      {provider.entrance_photo ? (
        <Image
          src={provider.entrance_photo}
          alt={t("entranceAlt", { name: provider.name })}
          width={480}
          height={320}
          loading="lazy"
          sizes="(max-width: 640px) 100vw, 240px"
          className="aspect-[3/2] w-full object-cover sm:w-60 sm:shrink-0"
        />
      ) : null}
      <div className="p-4 sm:p-5">
        <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.12em] text-[var(--color-brand-strong)]">
          <DoorOpen className="size-4" aria-hidden="true" />
          {t("findTheGate")}
        </p>
        <p className="mt-1.5 text-lg font-bold leading-snug">
          {provider.directions || t("entranceOnly")}
        </p>
      </div>
    </div>
  );
}

/**
 * Where the workshop is. Someone choosing between two of them is also
 * choosing a journey, and the address alone does not find a workshop in
 * Accra. The landmark would, but it is not shown: trainers were told it is
 * how the field officer finds them, not that it would be public. What the
 * workshop writes as public directions leads instead, in FindTheGate.
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

      <FindTheGate provider={provider} />

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
  // ?? because a response cached before videos existed has no such field.
  const videos = provider.videos ?? [];
  if (videos.length === 0) return null;

  return (
    <section aria-labelledby="videos-heading" className="lg:order-1">
      <h2 id="videos-heading" className="text-2xl font-bold tracking-tight">
        {t("videosTitle")}
      </h2>
      <p className="mt-1 text-sm leading-6 text-[var(--color-muted-foreground)]">
        {t("videosCaption", { brand: BRAND })}
      </p>

      <ul className="mt-4 grid gap-5 sm:grid-cols-2">
        {videos.map((video) => (
          <li key={video.id}>
            <VideoLesson
              video={video}
              playLabel={t("playVideo", { title: video.title })}
              qualityLabel={t("videoQuality")}
            />
            <p className="mt-2 text-sm font-semibold leading-5">{video.title}</p>
            {/* What the tap costs, said before it is spent: this user pays
                for data in small bundles. */}
            <p className="mt-1 flex items-center gap-1.5 text-xs text-[var(--color-muted-foreground)]">
              <Signal className="size-3.5 shrink-0" aria-hidden="true" />
              {videoCost(video, t)}
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * "12 minutes · about 40 MB": the length and the data the smallest copy
 * costs. A YouTube video, from before uploads, has neither on record.
 */
function videoCost(
  video: ProviderDetail["videos"][number],
  t: ReturnType<typeof useTranslations<"ProviderProfile">>,
) {
  const smallest = video.sources[0];
  if (video.kind === "youtube" || !video.duration_seconds || !smallest?.bytes) {
    return t("videoDataCost");
  }
  return t("videoMeta", {
    minutes: Math.max(1, Math.round(video.duration_seconds / 60)),
    mb: Math.max(1, Math.round(smallest.bytes / 1024 ** 2)),
  });
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
  const t = useTranslations("ProviderProfile");
  if (photos.length === 0) return null;

  return (
    <section aria-labelledby={headingId} className="lg:order-1">
      <h2 id={headingId} className="text-2xl font-bold tracking-tight">
        {title}
      </h2>
      <p className="mt-1 text-sm leading-6 text-[var(--color-muted-foreground)]">{caption}</p>

      <ul className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
        {photos.map((photo) =>
          photo.before ? (
            // A pair takes a whole row on a phone, so the slider is big
            // enough to drag with a thumb.
            <li key={photo.id} className="col-span-2">
              <BeforeAfter
                before={photo.before}
                after={photo.image}
                alt={photo.caption || title}
                labels={{
                  before: t("before"),
                  after: t("after"),
                  slider: t("beforeAfterSlider", { caption: photo.caption || title }),
                }}
              />
              {photo.caption ? (
                <p className="mt-1.5 text-xs leading-5 text-[var(--color-muted-foreground)]">
                  {photo.caption}
                </p>
              ) : null}
            </li>
          ) : (
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
          ),
        )}
      </ul>
    </section>
  );
}

const SPOKEN_NUMBER = new Intl.NumberFormat("en-GH", { maximumFractionDigits: 0 });
const SPOKEN_DATE = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });

/**
 * What ListenButton reads: the facts a trainee decides on, as plain spoken
 * sentences. Money is said as cedis rather than written with a sign a voice
 * stumbles over, and dates are spelled out.
 */
function listeningScript(
  provider: ProviderDetail,
  t: ReturnType<typeof useTranslations<"ProviderProfile">>,
  tFormat: ReturnType<typeof useTranslations<"Format">>,
) {
  const cheapest = [...provider.programmes].sort((a, b) => Number(a.fee) - Number(b.fee))[0];
  const intake = provider.programmes
    .flatMap((programme) => programme.intakes)
    .sort((a, b) => a.start_date.localeCompare(b.start_date))[0];
  const visit = provider.verifications[0];
  const spokenDate = (value: string) => SPOKEN_DATE.format(new Date(`${value.slice(0, 10)}T00:00:00Z`));
  return [
    t("listen.intro", { name: provider.name, area: provider.area }),
    cheapest
      ? t("listen.course", {
          title: cheapest.title,
          fee: SPOKEN_NUMBER.format(Number(cheapest.fee)),
          duration: formatDuration(cheapest.duration_weeks, tFormat),
        })
      : null,
    intake ? t("listen.intake", { date: spokenDate(intake.start_date) }) : null,
    visit
      ? t("listen.visited", { brand: BRAND, date: spokenDate(visit.visited_on) })
      : t("listen.notVisited", { brand: BRAND }),
    provider.directions ? t("listen.directions", { directions: provider.directions }) : null,
  ]
    .filter(Boolean)
    .join(" ");
}

export function ProviderProfile({ provider }: { provider: ProviderDetail }) {
  const t = useTranslations("ProviderProfile");
  const tFormat = useTranslations("Format");
  const locale = useLocale();
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

        {/* Pressed onto the photograph's corner: the first thing a trainee
            sees about a visited workshop is that someone went there. */}
        {provider.verifications[0] ? (
          <VisitStamp
            provider={provider}
            className="absolute left-3 top-3 bg-white/90 sm:left-5 sm:top-5"
          />
        ) : null}

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
          <ListenButton
            script={listeningScript(provider, t, tFormat)}
            lang={locale === "en" ? "en-GH" : locale}
            labels={{ listen: t("listen.button"), stop: t("listen.stop"), hint: t("listen.hint") }}
          />
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
          <MasterStrip provider={provider} />

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
