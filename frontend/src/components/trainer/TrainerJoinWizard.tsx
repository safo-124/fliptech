"use client";

import {zodResolver} from "@hookform/resolvers/zod";
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Building2,
  Check,
  CheckCircle2,
  Clock3,
  Eye,
  Loader2,
  LocateFixed,
  LockKeyhole,
  MapPin,
  Pencil,
  RefreshCw,
  ShieldCheck,
  Mail,
  Smartphone,
} from "lucide-react";
import Link from "next/link";
import {useSearchParams} from "next/navigation";
import {useTranslations} from "next-intl";
import {useEffect, useMemo, useRef, useState, type RefObject} from "react";
import {useForm, type FieldPath} from "react-hook-form";

import {TrainerAccountNotice} from "@/components/trainer/TrainerAccountNotice";
import {LocationPickerField} from "@/components/trainer/LocationPickerField";
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
import {Input} from "@/components/ui/input";
import {Label} from "@/components/ui/label";
import {NativeSelect} from "@/components/ui/native-select";
import {Separator} from "@/components/ui/separator";
import {Skeleton} from "@/components/ui/skeleton";
import {Textarea} from "@/components/ui/textarea";
import {validationMessage} from "@/i18n/validation";
import {BRAND} from "@/lib/brand";
import {TEACHING_LANGUAGES} from "@/lib/teaching-languages";
import {ghanaPhoneSchema, toGhanaE164} from "@/lib/phone";
import {
  getTrainerReferenceData,
  getTrainerSession,
  requestTrainerCode,
  requestTrainerEmailCode,
  deleteTrainerPhoto,
  getTrainerProfileBlockers,
  saveTrainerProfile,
  submitTrainerProfile,
  deleteTrainerLogo,
  uploadTrainerIdentityDocument,
  uploadTrainerLogo,
  uploadTrainerPhoto,
  TrainerApiError,
  verifyTrainerCode,
  verifyTrainerEmailCode,
} from "@/lib/trainer-api";
import {
  draftFromTrainerProfile,
  EMPTY_TRAINER_DRAFT,
  trainerDraftForStorage,
  trainerDraftSchemaFor,
  trainerProfilePayload,
  type TrainerDraftForm,
} from "@/lib/trainer-profile";
import type {
  ProviderPhotoKind,
  Trade,
  TrainerArea,
  TrainerPhoto,
  TrainerProfile,
  TrainerSession,
} from "@/lib/types";

const DRAFT_KEY = "skillshub.trainer.public-profile-draft";

// Long enough that a slow SMS has a chance to land before the button tempts
// another one, short enough not to feel like a punishment.
const RESEND_COOLDOWN_SECONDS = 45;

function countdown(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(seconds % 60).padStart(2, "0")}`;
}

type Step = "phone" | "code" | "you" | "workshop" | "photos" | "course" | "review" | "submitted";
type LocationState = "idle" | "loading" | "success" | "error";

/** The profile steps in order. Their names are in "TrainerJoinWizard.steps". */
const PROFILE_STEPS = ["you", "workshop", "photos", "course", "review"] as const satisfies readonly Step[];

// Identity comes first, before the workshop. It is four fields and it is the
// thing the confirming admin is actually deciding on; asking for it last, after
// someone has typed out their whole course, is how you lose the submission at
// the point it finally becomes clear that ID is required.
const IDENTITY_FIELDS: FieldPath<TrainerDraftForm>[] = [
  "full_name",
  "role",
  "id_document_type",
  "id_document_number",
];

const WORKSHOP_FIELDS: FieldPath<TrainerDraftForm>[] = [
  "name",
  "owner_name",
  "contact_phone",
  "area_id",
  "address",
  "landmark",
  "directions",
  "lead_trainer_name",
  "in_trade_since",
  "apprentices_trained",
  "teaching_languages",
  "latitude",
  "longitude",
  "year_established",
  "premises_tenure",
  "trainer_count",
  "trainee_count",
];

const COURSE_FIELDS: FieldPath<TrainerDraftForm>[] = [
  "trade_id",
  "programme_title",
  "fee",
  "duration_weeks",
  "instalments_allowed",
  "instalment_note",
  "hours_per_week",
  "weekly_schedule",
  "capacity",
  "fee_includes_tools",
  "fee_includes_materials",
  "fee_includes_ppe",
  "fee_includes_certificate",
  "certificate_awarded",
  "extra_costs",
  "extra_costs_note",
  "intake_start_date",
  "places_offered",
];

/** Which step shows a field, so an error the server sends can be taken there. */
const FIELD_STEPS: ReadonlyArray<readonly [FieldPath<TrainerDraftForm>[], Step]> = [
  [IDENTITY_FIELDS, "you"],
  [WORKSHOP_FIELDS, "workshop"],
  [COURSE_FIELDS, "course"],
];

function stepFor(field: FieldPath<TrainerDraftForm>): Step | null {
  return FIELD_STEPS.find(([fields]) => fields.includes(field))?.[1] ?? null;
}

const API_FIELD_NAMES: Record<string, FieldPath<TrainerDraftForm>> = {
  full_name: "full_name",
  role: "role",
  id_document_type: "id_document_type",
  id_document_number: "id_document_number",
  name: "name",
  owner_name: "owner_name",
  contact_phone: "contact_phone",
  area_id: "area_id",
  address: "address",
  landmark: "landmark",
  directions: "directions",
  lead_trainer_name: "lead_trainer_name",
  in_trade_since: "in_trade_since",
  apprentices_trained: "apprentices_trained",
  teaching_languages: "teaching_languages",
  latitude: "latitude",
  longitude: "longitude",
  year_established: "year_established",
  premises_tenure: "premises_tenure",
  trainer_count: "trainer_count",
  trainee_count: "trainee_count",
  "programme.trade_id": "trade_id",
  "programme.title": "programme_title",
  "programme.fee": "fee",
  "programme.duration_weeks": "duration_weeks",
  "programme.instalments_allowed": "instalments_allowed",
  "programme.instalment_note": "instalment_note",
  "programme.hours_per_week": "hours_per_week",
  "programme.weekly_schedule": "weekly_schedule",
  "programme.capacity": "capacity",
  "programme.extra_costs": "extra_costs",
  "programme.extra_costs_note": "extra_costs_note",
  "programme.intake.start_date": "intake_start_date",
  "programme.intake.places_offered": "places_offered",
};

const invalidControlClassName =
  "aria-invalid:border-[var(--color-destructive)] aria-invalid:ring-3 aria-invalid:ring-[var(--color-destructive)]/10";

function describedBy(...ids: Array<string | false | null | undefined>) {
  const value = ids.filter(Boolean).join(" ");
  return value || undefined;
}

function RequiredCue() {
  return (
    <span aria-hidden="true" className="ml-1 text-[var(--color-brand)]">
      *
    </span>
  );
}

function OptionalCue() {
  const t = useTranslations("TrainerJoinWizard");
  return <span className="font-normal text-[var(--color-muted-foreground)]">{t("optional")}</span>;
}

/** Eight per kind, so the two groups cannot crowd each other out. */
const MAX_PHOTOS_PER_KIND = 8;

/**
 * One labelled group of photographs.
 *
 * The workshop and the work are asked for separately because they answer
 * different questions, and a single "add photos" box gets two pictures of a
 * yard and nothing of the work. Filtering by kind here rather than keeping two
 * arrays means one upload response updates the right group without the caller
 * having to know which.
 */
/**
 * Under a photo of finished work: the same piece before it was done, or a way
 * to add one. Optional, and shown to trainees as a before-and-after slider.
 */
function BeforePair({
  work,
  photos,
  onAddBefore,
  onRemove,
}: {
  work: TrainerPhoto;
  photos: TrainerPhoto[];
  onAddBefore: (file: File, workId: number) => void;
  onRemove: (photoId: number) => void;
}) {
  const t = useTranslations("TrainerJoinWizard");
  const before = photos.find((photo) => photo.kind === "before" && photo.before_of === work.id);
  if (before) {
    return (
      <div className="mt-1.5 flex items-center gap-2 text-xs">
        {/* eslint-disable-next-line @next/next/no-img-element -- as above */}
        <img
          src={before.url}
          alt=""
          className="size-10 rounded-md border border-[var(--color-border)] object-cover"
        />
        <span className="min-w-0 flex-1 text-[var(--color-muted-foreground)]">{t("beforeAdded")}</span>
        <button
          type="button"
          onClick={() => onRemove(before.id)}
          className="min-h-11 px-1 font-medium underline underline-offset-4"
        >
          {t("remove")}
        </button>
      </div>
    );
  }
  return (
    <label className="mt-1 flex min-h-11 cursor-pointer items-center text-xs font-medium text-[var(--color-brand-strong)] underline-offset-4 hover:underline">
      <input
        type="file"
        accept="image/*"
        className="sr-only"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) onAddBefore(file, work.id);
        }}
      />
      {t("addBefore")}
    </label>
  );
}

function PhotoGroup({
  kind,
  title,
  hint,
  photos,
  uploading,
  onAdd,
  onAddBefore,
  onRemove,
  optional = false,
  max = MAX_PHOTOS_PER_KIND,
}: {
  kind: ProviderPhotoKind;
  title: string;
  hint: string;
  photos: TrainerPhoto[];
  uploading: boolean;
  onAdd: (file: File, kind: ProviderPhotoKind) => void;
  /** For finished work: each photo can be paired with the same piece before. */
  onAddBefore?: (file: File, workId: number) => void;
  onRemove: (photoId: number) => void;
  optional?: boolean;
  max?: number;
}) {
  const t = useTranslations("TrainerJoinWizard");
  const mine = photos.filter((photo) => photo.kind === kind);
  const inputId = `photo-input-${kind}`;

  return (
    <fieldset disabled={uploading} className="space-y-3">
      <legend className="text-sm font-semibold">
        {title}
        {optional ? <> <OptionalCue /></> : <RequiredCue />}
      </legend>
      <p className="text-xs leading-5 text-[var(--color-muted-foreground)]">{hint}</p>

      {mine.length ? (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {mine.map((photo) => (
            <li key={photo.id} className="relative">
              {/* A plain img, not next/image: these are just-uploaded files on
                  an origin the optimiser is not configured for, and the trainer
                  only needs a thumbnail to confirm the right photo landed. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={photo.url}
                alt={photo.caption || title}
                className="aspect-4/3 w-full rounded-xl border border-[var(--color-border)] object-cover"
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => onRemove(photo.id)}
                className="absolute right-1.5 top-1.5 h-8 min-h-0 bg-[var(--color-card)] px-2 text-xs"
              >
                {t("remove")}
              </Button>
              {onAddBefore ? (
                <BeforePair
                  work={photo}
                  photos={photos}
                  onAddBefore={onAddBefore}
                  onRemove={onRemove}
                />
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}

      {mine.length < max ? (
        <div className="space-y-2">
          <Label htmlFor={inputId} className="sr-only">
            {t("addPhotoLabel", {title})}
          </Label>
          <Input
            id={inputId}
            type="file"
            accept="image/*"
            // capture hints the camera on a phone, which is where these are
            // actually taken.
            capture="environment"
            onChange={(event) => {
              const file = event.target.files?.[0];
              // Cleared straight away so the same file can be picked again
              // after a failed upload — without this, choosing it a second
              // time fires no change event at all.
              event.target.value = "";
              if (file) onAdd(file, kind);
            }}
          />
          <p className="text-xs text-[var(--color-muted-foreground)]">
            {t("photosAdded", {count: mine.length, max})}
          </p>
        </div>
      ) : null}
    </fieldset>
  );
}

/** A field's error. Schema messages are "Validation" keys, worded here; a
 *  message the server sent is shown as it came. */
function FieldError({id, message}: {id: string; message?: string}) {
  const t = useTranslations("Validation");
  const text = validationMessage(t, message);
  return text ? (
    <p
      id={id}
      role="alert"
      className="mt-1.5 flex items-start gap-1.5 text-sm text-[var(--color-destructive)]"
    >
      <AlertCircle aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
      <span>{text}</span>
    </p>
  ) : null;
}

function FormError({id, message}: {id: string; message: string}) {
  return (
    <Alert id={id} variant="warning">
      <AlertCircle aria-hidden="true" />
      <AlertDescription>
        <p>{message}</p>
      </AlertDescription>
    </Alert>
  );
}

function Progress({step}: {step: Step}) {
  const t = useTranslations("TrainerJoinWizard");
  const current = (PROFILE_STEPS as readonly Step[]).indexOf(step);
  if (current < 0) return null;

  return (
    <nav
      aria-label={t("progressLabel")}
      className="mb-5 rounded-2xl border border-[var(--color-border)] bg-[var(--color-card)]/85 p-4 shadow-xs sm:p-5"
    >
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--color-muted-foreground)]">
          {t("profileSetup")}
        </p>
        <Badge variant="secondary">
          {t("stepOf", {current: current + 1, total: PROFILE_STEPS.length})}
        </Badge>
      </div>
      <ol className="mt-4 grid grid-cols-3 gap-2 sm:gap-4">
        {PROFILE_STEPS.map((item, index) => {
          const complete = index < current;
          const active = index === current;
          return (
            <li key={item} aria-current={active ? "step" : undefined} className="min-w-0">
              <div
                aria-hidden="true"
                className={`mb-2 h-1.5 rounded-full ${
                  index <= current ? "bg-[var(--color-brand)]" : "bg-[var(--color-muted)]"
                }`}
              />
              <span
                className={`flex items-center gap-1.5 truncate text-xs font-medium sm:text-sm ${
                  active
                    ? "text-[var(--color-foreground)]"
                    : complete
                      ? "text-[var(--color-brand-strong)]"
                      : "text-[var(--color-muted-foreground)]"
                }`}
              >
                {complete ? <Check aria-hidden="true" className="size-3.5 shrink-0" /> : null}
                {t(`steps.${item}`)}
              </span>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

function statusVariant(status: string): "default" | "secondary" | "warning" | "outline" {
  if (status === "published") return "default";
  if (status === "pending_approval" || status === "changes_requested" || status === "suspended") {
    return "warning";
  }
  if (status === "draft") return "secondary";
  return "outline";
}

function ExistingProfile({
  profile,
  headingRef,
}: {
  profile: TrainerProfile;
  headingRef: RefObject<HTMLHeadingElement | null>;
}) {
  const t = useTranslations("TrainerJoinWizard");
  const tStatus = useTranslations("ListingStatus");
  return (
    <section aria-labelledby="existing-profile-heading" data-trainer-existing-profile>
      <Card className="relative overflow-hidden">
        <div
          aria-hidden="true"
          className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-[var(--color-brand)] via-[var(--color-brand-strong)] to-[var(--color-primary)]"
        />
        <CardHeader className="pb-4 pt-7 sm:px-6">
          <Badge variant={statusVariant(profile.status)}>
            {profile.status === "published" ? (
              <CheckCircle2 aria-hidden="true" />
            ) : (
              <Clock3 aria-hidden="true" />
            )}
            {tStatus.has(profile.status as "draft")
              ? tStatus(profile.status as "draft")
              : profile.status_label}
          </Badge>
          <h2
            id="existing-profile-heading"
            ref={headingRef}
            tabIndex={-1}
            className="scroll-mt-24 pt-2 text-xl font-bold tracking-tight outline-none sm:text-2xl"
          >
            {profile.name}
          </h2>
          <CardDescription className="max-w-xl">
            {profile.status === "pending_approval" ? t("withTeam") : t("openDashboardHint")}
          </CardDescription>
        </CardHeader>
        {profile.review_note ? (
          <CardContent className="sm:px-6">
            <div className="flex items-start gap-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-muted)]/70 p-4 text-sm">
              <AlertCircle
                aria-hidden="true"
                className="mt-0.5 size-4 shrink-0 text-[var(--color-warn)]"
              />
              <div>
                <strong className="block font-semibold">{t("reviewNote")}</strong>
                <p className="mt-1 text-[var(--color-muted-foreground)]">{profile.review_note}</p>
              </div>
            </div>
          </CardContent>
        ) : null}
        <CardFooter className="sm:px-6">
          <Button asChild variant="brand" className="w-full sm:w-auto">
            <Link href="/trainer/dashboard">
              {t("openDashboard")}
              <ArrowRight aria-hidden="true" />
            </Link>
          </Button>
        </CardFooter>
      </Card>
    </section>
  );
}

/** Also the page's Suspense fallback while the query string is read. */
export function TrainerJoinWizardLoading() {
  return <LoadingCard />;
}

function LoadingCard() {
  const t = useTranslations("TrainerJoinWizard");
  return (
    <div role="status" aria-live="polite" aria-busy="true">
      <span className="sr-only">{t("loading")}</span>
      <Card aria-hidden="true">
        <CardHeader>
          <Skeleton className="h-5 w-24" />
          <Skeleton className="mt-2 h-7 w-2/3" />
          <Skeleton className="mt-1 h-4 w-full max-w-md" />
        </CardHeader>
        <CardContent className="space-y-4">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
        </CardContent>
      </Card>
    </div>
  );
}

export function TrainerJoinWizard() {
  const t = useTranslations("TrainerJoinWizard");
  const tValidation = useTranslations("Validation");
  const tFormat = useTranslations("Format");
  const tLanguage = useTranslations("TeachingLanguages");
  // Which door they came through. There is only one flow — passwordless means
  // signing up and signing in are the same act — but somebody who clicked
  // "Sign up as a trainer" and landed on "Sign in with your phone" reasonably
  // concludes they are in the wrong place and that they need an account first.
  // The flow does not change; the framing does. Same as the trainee sign-up.
  const joining = useSearchParams().get("new") === "1";
  const [step, setStep] = useState<Step>("phone");
  /**
   * Which identifier the sign-in step is using.
   *
   * Phone is the default and stays the default: it is the account's identity,
   * the number a site visit is arranged on, and the only route that works for
   * a trainer who has not added an address yet.
   */
  const [authMethod, setAuthMethod] = useState<"phone" | "email">("phone");
  const [authEmail, setAuthEmail] = useState("");
  const [photos, setPhotos] = useState<TrainerPhoto[]>([]);
  const [hasIdDocument, setHasIdDocument] = useState(false);
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [blockers, setBlockers] = useState<string[]>([]);
  // Upload failures are kept apart from `error`, which drives the whole-form
  // banner. A photo that was too large should not read like the profile failed
  // to save.
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [session, setSession] = useState<TrainerSession | null>(null);
  const [profile, setProfile] = useState<TrainerProfile | null>(null);
  const [areas, setAreas] = useState<TrainerArea[]>([]);
  const [trades, setTrades] = useState<Trade[]>([]);
  const [phone, setPhone] = useState("");
  const [challengeId, setChallengeId] = useState("");
  const [code, setCode] = useState("");
  const [expiresIn, setExpiresIn] = useState<number | null>(null);
  const [resendIn, setResendIn] = useState(0);
  const [resent, setResent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [locationMessage, setLocationMessage] = useState<string | null>(null);
  const [locationState, setLocationState] = useState<LocationState>("idle");
  const stepHeadingRef = useRef<HTMLHeadingElement>(null);
  const previousStepRef = useRef<Step>("phone");

  // Rebuilt when the loaded profile changes, so the intake rule knows which
  // date is already stored and therefore still allowed.
  const storedIntakeDate = profile?.programme?.intake?.start_date ?? null;
  const resolver = useMemo(
    () => zodResolver(trainerDraftSchemaFor(storedIntakeDate)),
    [storedIntakeDate],
  );

  const form = useForm<TrainerDraftForm>({
    resolver,
    defaultValues: EMPTY_TRAINER_DRAFT,
  });
  const {
    register,
    getValues,
    handleSubmit,
    reset,
    setError: setFieldError,
    setFocus,
    setValue,
    trigger,
    watch,
    formState: {errors},
  } = form;

  useEffect(() => {
    let active = true;
    Promise.all([getTrainerSession(), getTrainerReferenceData()])
      .then(([nextSession, reference]) => {
        if (!active) return;
        setSession(nextSession);
        setAreas(reference.areas);
        setTrades(reference.trades);

        if (nextSession.authenticated) {
          setPhone(nextSession.phone);
          if (nextSession.profile) {
            setProfile(nextSession.profile);
            reset(draftFromTrainerProfile(nextSession.profile));
            setStep(nextSession.profile.editable ? "you" : "submitted");
          } else {
            const saved = sessionStorage.getItem(DRAFT_KEY);
            if (saved) {
              try {
                reset({...EMPTY_TRAINER_DRAFT, ...JSON.parse(saved)});
              } catch {
                sessionStorage.removeItem(DRAFT_KEY);
              }
            }
            if (!getValues("contact_phone")) setValue("contact_phone", nextSession.phone);
            setStep("you");
          }
        }
      })
      .catch((reason) => {
        if (!active) return;
        setError(reason instanceof Error ? reason.message : t("loadFailed"));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [getValues, reset, setValue, t]);

  useEffect(() => {
    if (!session?.authenticated) return;
    // React Hook Form intentionally exposes watch as an imperative
    // subscription here; no watched value crosses a memoized boundary.
    // eslint-disable-next-line react-hooks/incompatible-library
    const subscription = watch((values) => {
      // Only public profile fields are persisted. Auth phone, OTP and
      // challenge values never enter this object.
      sessionStorage.setItem(DRAFT_KEY, JSON.stringify(trainerDraftForStorage(values)));
    });
    return () => subscription.unsubscribe();
  }, [session, watch]);

  // One second tick for the code step. It drives both the time left on the
  // current code and the cooldown before another can be sent — a static "expires
  // in 10 minutes" that never moved was still claiming ten minutes nine minutes
  // later, which is worse than showing nothing.
  useEffect(() => {
    if (step !== "code") return;
    const timer = window.setInterval(() => {
      setExpiresIn((seconds) => (seconds === null ? null : Math.max(0, seconds - 1)));
      setResendIn((seconds) => Math.max(0, seconds - 1));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [step]);

  useEffect(() => {
    if (loading || previousStepRef.current === step) return;
    previousStepRef.current = step;
    const frame = window.requestAnimationFrame(() => {
      const heading = stepHeadingRef.current;
      if (!heading) return;
      const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      heading.focus({preventScroll: true});
      heading.scrollIntoView({behavior: reduceMotion ? "auto" : "smooth", block: "start"});
    });
    return () => window.cancelAnimationFrame(frame);
  }, [loading, step]);

  async function requestCode(event: React.FormEvent) {
    event.preventDefault();

    if (authMethod === "email") {
      const address = authEmail.trim();
      // Shallow on purpose: the server validates, and a clever regex rejects
      // real addresses.
      if (!address.includes("@")) {
        setError(t("enterEmail"));
        return;
      }
      setBusy(true);
      setError(null);
      try {
        const result = await requestTrainerEmailCode(address);
        setChallengeId(result.challenge_id);
        setExpiresIn(result.expires_in_seconds);
        setResendIn(RESEND_COOLDOWN_SECONDS);
        setResent(false);
        setStep("code");
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : t("codeSendFailed"));
      } finally {
        setBusy(false);
      }
      return;
    }

    const parsed = ghanaPhoneSchema.safeParse(phone);
    if (!parsed.success) {
      setError(
        validationMessage(tValidation, parsed.error.issues[0]?.message) ?? t("enterValidPhone"),
      );
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const normalized = toGhanaE164(parsed.data);
      const result = await requestTrainerCode(normalized);
      setPhone(normalized);
      setChallengeId(result.challenge_id);
      setExpiresIn(result.expires_in_seconds);
      setResendIn(RESEND_COOLDOWN_SECONDS);
      setResent(false);
      setStep("code");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t("codeSendFailed"));
    } finally {
      setBusy(false);
    }
  }

  /**
   * Send a second code to the same number.
   *
   * Without this the only way out of an SMS that never arrived was "Change
   * phone number" and retyping the same digits — which works, but reads as a
   * dead end at the exact moment someone is deciding whether this is worth the
   * trouble. Undelivered messages are ordinary on Ghanaian networks.
   *
   * The new challenge replaces the old one; the server issues a fresh id and
   * the previous code stops being the one it will accept.
   */
  async function resendCode() {
    if (resendIn > 0 || busy) return;
    setBusy(true);
    setError(null);
    try {
      // Resend has to follow the method the first code went out on, or an
      // email sign-in silently sends the replacement as an SMS.
      const result =
        authMethod === "email"
          ? await requestTrainerEmailCode(authEmail.trim())
          : await requestTrainerCode(phone);
      setChallengeId(result.challenge_id);
      setExpiresIn(result.expires_in_seconds);
      setResendIn(RESEND_COOLDOWN_SECONDS);
      setResent(true);
      setCode("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t("resendFailed"));
    } finally {
      setBusy(false);
    }
  }

  async function verifyCode(event: React.FormEvent) {
    event.preventDefault();
    if (!/^\d{4,8}$/.test(code)) {
      setError(authMethod === "email" ? t("enterEmailCode") : t("enterPhoneCode"));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const nextSession =
        authMethod === "email"
          ? await verifyTrainerEmailCode(challengeId, authEmail.trim(), code)
          : await verifyTrainerCode(challengeId, phone, code);
      if (!nextSession.authenticated) throw new Error(t("sessionNotCreated"));
      setSession(nextSession);
      setProfile(nextSession.profile);
      if (nextSession.profile) {
        reset(draftFromTrainerProfile(nextSession.profile));
        setStep(nextSession.profile.editable ? "you" : "submitted");
      } else {
        const saved = sessionStorage.getItem(DRAFT_KEY);
        if (saved) {
          try {
            reset({...EMPTY_TRAINER_DRAFT, ...JSON.parse(saved)});
          } catch {
            sessionStorage.removeItem(DRAFT_KEY);
          }
        }
        if (!getValues("contact_phone")) setValue("contact_phone", phone);
        setStep("you");
      }
      setCode("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t("codeFailed"));
    } finally {
      setBusy(false);
    }
  }

  async function continueFrom(fields: FieldPath<TrainerDraftForm>[], next: Step) {
    setError(null);
    const valid = await trigger(fields, {shouldFocus: true});
    if (valid) setStep(next);
  }

  /**
   * Validate, save the draft, then advance.
   *
   * The upload endpoints attach files to a provider row, so one has to exist
   * before the photos step is any use — the API answers 409 "create your
   * workshop details first" otherwise. Saving on the way in also means the
   * workshop details survive a phone that dies during the photo step, which
   * is the longest and most data-hungry part of the form.
   */
  async function saveThenContinue(fields: FieldPath<TrainerDraftForm>[], next: Step) {
    setError(null);
    const valid = await trigger(fields, {shouldFocus: true});
    if (!valid) return;
    setBusy(true);
    try {
      const saved = await saveTrainerProfile(trainerProfilePayload(getValues()));
      setProfile(saved);
      setPhotos(saved.photos);
      setLogoUrl(saved.logo);
      setHasIdDocument(saved.identity?.has_document ?? false);
      if (next === "review") {
        // Ask the server what it would still refuse on, so the checklist on
        // the review step is the API's own answer rather than a second
        // implementation of the same rules drifting beside it.
        const {blockers: outstanding} = await getTrainerProfileBlockers();
        setBlockers(outstanding);
      }
      setStep(next);
    } catch (reason) {
      if (reason instanceof TrainerApiError) applyApiErrors(reason);
      else setError(reason instanceof Error ? reason.message : t("saveFailed"));
    } finally {
      setBusy(false);
    }
  }

  async function addPhoto(file: File, kind: ProviderPhotoKind, beforeOf?: number) {
    setUploadError(null);
    setUploading(true);
    try {
      const photo = await uploadTrainerPhoto(file, kind, "", beforeOf);
      // A new photo of the way in, or of the master, replaces the last, on
      // the server and here.
      const replaces = kind === "entrance" || kind === "portrait";
      setPhotos((current) => [
        ...current.filter((existing) => !replaces || existing.kind !== kind),
        photo,
      ]);
    } catch (reason) {
      setUploadError(reason instanceof Error ? reason.message : t("photoUploadFailed"));
    } finally {
      setUploading(false);
    }
  }

  async function removePhoto(photoId: number) {
    setUploadError(null);
    try {
      await deleteTrainerPhoto(photoId);
      // Removing finished work removes its 'before' with it, on the server too.
      setPhotos((current) =>
        current.filter((photo) => photo.id !== photoId && photo.before_of !== photoId),
      );
    } catch (reason) {
      setUploadError(reason instanceof Error ? reason.message : t("photoRemoveFailed"));
    }
  }

  async function setLogo(file: File) {
    setUploadError(null);
    setUploading(true);
    try {
      const result = await uploadTrainerLogo(file);
      setLogoUrl(result.url);
    } catch (reason) {
      setUploadError(reason instanceof Error ? reason.message : t("logoUploadFailed"));
    } finally {
      setUploading(false);
    }
  }

  async function removeLogo() {
    setUploadError(null);
    try {
      await deleteTrainerLogo();
      setLogoUrl(null);
    } catch (reason) {
      setUploadError(reason instanceof Error ? reason.message : t("logoRemoveFailed"));
    }
  }

  async function addIdDocument(file: File) {
    setUploadError(null);
    setUploading(true);
    try {
      await uploadTrainerIdentityDocument(file);
      setHasIdDocument(true);
    } catch (reason) {
      setUploadError(reason instanceof Error ? reason.message : t("documentUploadFailed"));
    } finally {
      setUploading(false);
    }
  }

  /** Single writer for the pin: the map, the GPS button and the inputs agree. */
  function setCoordinates({lat, lng}: {lat: number; lng: number}) {
    setValue("latitude", lat.toFixed(6), {shouldValidate: true, shouldDirty: true});
    setValue("longitude", lng.toFixed(6), {shouldValidate: true, shouldDirty: true});
  }

  function useCurrentLocation() {
    setLocationMessage(null);
    if (!("geolocation" in navigator)) {
      setLocationState("error");
      setLocationMessage(t("locationUnsupported"));
      return;
    }
    setLocationState("loading");
    setLocationMessage(t("locationFinding"));
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setCoordinates({lat: position.coords.latitude, lng: position.coords.longitude});
        setLocationState("success");
        // GPS indoors is routinely out by the width of a street, so this is
        // where the pin starts, not where it ends.
        setLocationMessage(t("locationFound"));
      },
      () => {
        setLocationState("error");
        setLocationMessage(t("locationUnavailable"));
      },
      {enableHighAccuracy: true, timeout: 15_000},
    );
  }

  function applyApiErrors(reason: TrainerApiError) {
    const refused: FieldPath<TrainerDraftForm>[] = [];
    for (const [apiName, message] of Object.entries(reason.fields)) {
      const formName = API_FIELD_NAMES[apiName];
      if (!formName) continue;
      refused.push(formName);
      setFieldError(formName, {type: "server", message});
    }
    // Every save sends the whole profile, so a field the server refused can
    // be on another step — on submit, it always is. Stay if one is on this
    // step, otherwise go to the first: an error beside a field nobody can see
    // is no error at all.
    const first = refused.find((field) => stepFor(field) === step) ?? refused[0];
    if (first) {
      const target = stepFor(first);
      if (target && target !== step) setStep(target);
      requestAnimationFrame(() => setFocus(first));
    }
    setError(reason.fields.detail ?? (!first ? reason.message : null));
  }

  const saveAndSubmit = handleSubmit(async (values) => {
    setBusy(true);
    setError(null);
    try {
      await saveTrainerProfile(trainerProfilePayload(values));
      const submitted = await submitTrainerProfile();
      sessionStorage.removeItem(DRAFT_KEY);
      setProfile(submitted);
      setSession({authenticated: true, phone, profile: submitted});
      setStep("submitted");
    } catch (reason) {
      if (reason instanceof TrainerApiError) applyApiErrors(reason);
      else setError(reason instanceof Error ? reason.message : t("submitFailed"));
      // A refused submit is nearly always something missing rather than
      // something wrong, so re-read the checklist instead of leaving the
      // trainer with a banner and no next action.
      try {
        const {blockers: outstanding} = await getTrainerProfileBlockers();
        setBlockers(outstanding);
      } catch {
        // The submit error already on screen is the more useful one.
      }
    } finally {
      setBusy(false);
    }
  });

  if (loading) return <LoadingCard />;

  if (error && !session && step === "phone") {
    return (
      <Card role="alert" className="border-[var(--color-warn)]/20">
        <CardHeader>
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

  if (step === "submitted" && profile) {
    return (
      <>
        <TrainerAccountNotice session={session} />
        <ExistingProfile profile={profile} headingRef={stepHeadingRef} />
      </>
    );
  }

  if (step === "phone") {
    return (
      <Card className="overflow-hidden">
        <CardHeader className="pb-4 sm:px-6 sm:pt-6">
          <div className="mb-2 grid size-11 place-items-center rounded-xl bg-[var(--color-brand-soft)] text-[var(--color-brand-strong)]">
            {authMethod === "email" ? (
              <Mail aria-hidden="true" className="size-5" />
            ) : (
              <Smartphone aria-hidden="true" className="size-5" />
            )}
          </div>
          <h2
            ref={stepHeadingRef}
            tabIndex={-1}
            className="scroll-mt-24 text-xl font-bold tracking-tight outline-none"
          >
            {authMethod === "email"
              ? t("signInEmailTitle")
              : joining
                ? t("joinTitle")
                : t("signInPhoneTitle")}
          </h2>
          <CardDescription>
            {authMethod === "email"
              ? t("signInEmailLead")
              : joining
                ? t("joinLead")
                : t("signInPhoneLead")}
          </CardDescription>
        </CardHeader>
        <form onSubmit={requestCode} noValidate aria-busy={busy}>
          <CardContent className="space-y-4 sm:px-6">
            {authMethod === "email" ? (
              <div className="space-y-2">
                <Label htmlFor="trainer-email">
                  {t("emailLabel")}
                  <RequiredCue />
                </Label>
                <Input
                  id="trainer-email"
                  name="email"
                  type="email"
                  inputMode="email"
                  autoComplete="email"
                  placeholder="you@example.com"
                  value={authEmail}
                  onChange={(event) => setAuthEmail(event.target.value)}
                  required
                  aria-invalid={Boolean(error)}
                  aria-describedby={describedBy(
                    "trainer-email-help",
                    error && "trainer-phone-error",
                  )}
                />
                <p
                  id="trainer-email-help"
                  className="text-xs leading-5 text-[var(--color-muted-foreground)]"
                >
                  {t("emailHelp")}
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                <Label htmlFor="trainer-phone">
                  {t("phoneLabel")}
                  <RequiredCue />
                </Label>
                <Input
                  id="trainer-phone"
                  name="phone"
                  type="tel"
                  inputMode="tel"
                  autoComplete="tel"
                  placeholder="024 123 4567"
                  value={phone}
                  onChange={(event) => setPhone(event.target.value)}
                  required
                  aria-invalid={Boolean(error)}
                  aria-describedby={describedBy("trainer-phone-help", error && "trainer-phone-error")}
                />
                <p id="trainer-phone-help" className="text-xs leading-5 text-[var(--color-muted-foreground)]">
                  {t("phoneHelp")}
                </p>
              </div>
            )}
            {error ? <FormError id="trainer-phone-error" message={error} /> : null}
            <div className="flex items-start gap-2.5 rounded-xl bg-[var(--color-muted)]/65 p-3 text-xs leading-5 text-[var(--color-muted-foreground)]">
              <LockKeyhole
                aria-hidden="true"
                className="mt-0.5 size-4 shrink-0 text-[var(--color-brand-strong)]"
              />
              <p>{t("staysPrivate")}</p>
            </div>
          </CardContent>
          <CardFooter className="flex-col gap-2 sm:px-6">
            <Button type="submit" variant="brand" disabled={busy} className="w-full">
              {busy ? <Loader2 aria-hidden="true" className="animate-spin" /> : null}
              {busy ? t("sendingCode") : t("continue")}
              {!busy ? <ArrowRight aria-hidden="true" /> : null}
            </Button>
            {/* Hidden for somebody joining. account_for_verified_email never
                creates a trainer account — email is a second door into one
                that exists — so offering it to a first-time trainer is a door
                that cannot open: they would type their address, get a code,
                and be told to use their phone. A returning trainer who came in
                through a sign-up link is signed in by the phone step anyway. */}
            {joining ? null : (
              <Button
                type="button"
                variant="ghost"
                className="w-full"
                onClick={() => {
                  setAuthMethod(authMethod === "email" ? "phone" : "email");
                  setError(null);
                }}
              >
                {authMethod === "email" ? (
                  <>
                    <Smartphone aria-hidden="true" />
                    {t("usePhone")}
                  </>
                ) : (
                  <>
                    <Mail aria-hidden="true" />
                    {t("useEmail")}
                  </>
                )}
              </Button>
            )}
          </CardFooter>
        </form>
      </Card>
    );
  }

  if (step === "code") {
    return (
      <Card className="overflow-hidden">
        <CardHeader className="pb-4 text-center sm:px-6 sm:pt-6">
          <div className="mx-auto mb-2 grid size-11 place-items-center rounded-xl bg-[var(--color-brand-soft)] text-[var(--color-brand-strong)]">
            <ShieldCheck aria-hidden="true" className="size-5" />
          </div>
          <h2
            ref={stepHeadingRef}
            tabIndex={-1}
            className="scroll-mt-24 text-xl font-bold tracking-tight outline-none"
          >
            {authMethod === "email" ? t("checkEmail") : t("checkMessages")}
          </h2>
          <CardDescription>{t("codeLead")}</CardDescription>
        </CardHeader>
        <form onSubmit={verifyCode} noValidate aria-busy={busy}>
          <CardContent className="space-y-4 sm:px-6">
            <div className="space-y-2">
              <Label htmlFor="trainer-code">
                {t("codeLabel")}
                <RequiredCue />
              </Label>
              <Input
                id="trainer-code"
                name="verification-code"
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9]*"
                maxLength={8}
                value={code}
                onChange={(event) => setCode(event.target.value.replace(/\D/g, ""))}
                required
                aria-invalid={Boolean(error)}
                aria-describedby={describedBy("trainer-code-help", error && "trainer-code-error")}
                className="text-center text-xl font-semibold tabular-nums tracking-[0.3em] sm:text-xl"
              />
              <p id="trainer-code-help" className="text-center text-xs leading-5 text-[var(--color-muted-foreground)]">
                {t("sentTo", {destination: authMethod === "email" ? authEmail.trim() : phone})}
                {expiresIn === null ? null : expiresIn > 0 ? (
                  <>
                    {" · "}
                    {t.rich("expiresIn", {
                      time: countdown(expiresIn),
                      clock: (chunks) => <span className="tabular-nums">{chunks}</span>,
                    })}
                  </>
                ) : (
                  ` · ${t("codeExpired")}`
                )}
              </p>
              <p aria-live="polite" className="sr-only">
                {resent ? t("newCodeSent") : ""}
              </p>
            </div>
            {error ? <FormError id="trainer-code-error" message={error} /> : null}
          </CardContent>
          <CardFooter className="flex-col gap-2 sm:px-6">
            <Button
              type="submit"
              variant="brand"
              disabled={busy || expiresIn === 0}
              className="w-full"
            >
              {busy ? (
                <Loader2 aria-hidden="true" className="animate-spin" />
              ) : (
                <ShieldCheck aria-hidden="true" />
              )}
              {busy ? t("checking") : t("verify")}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={resendCode}
              disabled={busy || resendIn > 0}
              className="w-full"
            >
              <RefreshCw aria-hidden="true" />
              {resendIn > 0 ? t("sendAgainIn", {time: countdown(resendIn)}) : t("sendAnother")}
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setStep("phone");
                setError(null);
              }}
              className="w-full"
            >
              <ArrowLeft aria-hidden="true" />
              {t("changePhone")}
            </Button>
          </CardFooter>
        </form>
      </Card>
    );
  }

  const values = getValues();
  const selectedArea = areas.find((area) => String(area.id) === values.area_id);
  // Somewhere sensible to open the map before a pin exists: the middle of the
  // area they picked beats the middle of Ghana.
  const areaCentroid =
    selectedArea && selectedArea.centroid_lat !== null && selectedArea.centroid_lng !== null
      ? {lat: selectedArea.centroid_lat, lng: selectedArea.centroid_lng}
      : null;
  const selectedTrade = trades.find((trade) => String(trade.id) === values.trade_id);
  const instalmentsAllowed = watch("instalments_allowed");
  const feeIncludesCertificate = watch("fee_includes_certificate");
  const intakeStartDate = watch("intake_start_date");

  return (
    <form onSubmit={saveAndSubmit} noValidate aria-busy={busy}>
      <Progress step={step} />

      {step === "you" ? (
        <section aria-labelledby="you-heading">
          <Card className="overflow-hidden">
            <CardHeader className="pb-4 sm:px-6 sm:pt-6">
              <div className="mb-2 flex items-center justify-between gap-3">
                <div className="grid size-11 place-items-center rounded-xl bg-[var(--color-brand-soft)] text-[var(--color-brand-strong)]">
                  <ShieldCheck aria-hidden="true" className="size-5" />
                </div>
                <p className="text-xs text-[var(--color-muted-foreground)]">
                  <span aria-hidden="true" className="text-[var(--color-brand)]">*</span> {t("requiredFields")}
                </p>
              </div>
              <h2
                id="you-heading"
                ref={stepHeadingRef}
                tabIndex={-1}
                className="text-xl font-bold tracking-tight outline-none sm:text-2xl"
              >
                {t("aboutYouTitle")}
              </h2>
              <CardDescription>{t("aboutYouLead")}</CardDescription>
            </CardHeader>
            <CardContent className="sm:px-6">
              <fieldset disabled={busy} className="space-y-5">
                <div className="space-y-2">
                  <Label htmlFor="full_name">
                    {t("fullNameLabel")} <span aria-hidden="true" className="text-[var(--color-brand)]">*</span>
                  </Label>
                  <Input
                    id="full_name"
                    autoComplete="name"
                    {...register("full_name")}
                    aria-invalid={errors.full_name ? true : undefined}
                  />
                  <FieldError id="full-name-error" message={errors.full_name?.message} />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="role">
                    {t("roleLabel")} <span aria-hidden="true" className="text-[var(--color-brand)]">*</span>
                  </Label>
                  <NativeSelect id="role" {...register("role")} aria-invalid={errors.role ? true : undefined}>
                    <option value="">{t("chooseOne")}</option>
                    <option value="owner">{t("roles.owner")}</option>
                    <option value="manager">{t("roles.manager")}</option>
                    <option value="lead_trainer">{t("roles.lead_trainer")}</option>
                  </NativeSelect>
                  <FieldError id="role-error" message={errors.role?.message} />
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="id_document_type">
                      {t("idTypeLabel")} <span aria-hidden="true" className="text-[var(--color-brand)]">*</span>
                    </Label>
                    <NativeSelect
                      id="id_document_type"
                      {...register("id_document_type")}
                      aria-invalid={errors.id_document_type ? true : undefined}
                    >
                      <option value="">{t("chooseOne")}</option>
                      <option value="ghana_card">{t("idTypes.ghana_card")}</option>
                      <option value="passport">{t("idTypes.passport")}</option>
                      <option value="voter_id">{t("idTypes.voter_id")}</option>
                    </NativeSelect>
                    <FieldError id="id-type-error" message={errors.id_document_type?.message} />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="id_document_number">
                      {t("idNumberLabel")} <span aria-hidden="true" className="text-[var(--color-brand)]">*</span>
                    </Label>
                    <Input
                      id="id_document_number"
                      {...register("id_document_number")}
                      aria-invalid={errors.id_document_number ? true : undefined}
                    />
                    <FieldError id="id-number-error" message={errors.id_document_number?.message} />
                  </div>
                </div>

                <Alert>
                  <LockKeyhole aria-hidden="true" className="size-4" />
                  <AlertDescription>
                    {t("idPhotoNote", {brand: BRAND})}
                  </AlertDescription>
                </Alert>
              </fieldset>
            </CardContent>
            <CardFooter className="sm:px-6">
              <Button
                type="button"
                variant="brand"
                onClick={() => continueFrom(IDENTITY_FIELDS, "workshop")}
                className="w-full"
              >
                {t("continueToWorkshop")}
                <ArrowRight aria-hidden="true" />
              </Button>
            </CardFooter>
          </Card>
        </section>
      ) : null}

      {step === "workshop" ? (
        <section aria-labelledby="workshop-heading">
          <Card className="overflow-hidden">
            <CardHeader className="pb-4 sm:px-6 sm:pt-6">
              <div className="mb-2 flex items-center justify-between gap-3">
                <div className="grid size-11 place-items-center rounded-xl bg-[var(--color-brand-soft)] text-[var(--color-brand-strong)]">
                  <Building2 aria-hidden="true" className="size-5" />
                </div>
                <p className="text-xs text-[var(--color-muted-foreground)]">
                  <span aria-hidden="true" className="text-[var(--color-brand)]">*</span> {t("requiredFields")}
                </p>
              </div>
              <h2
                id="workshop-heading"
                ref={stepHeadingRef}
                tabIndex={-1}
                className="scroll-mt-24 text-xl font-bold tracking-tight outline-none"
              >
                {t("workshopTitle")}
              </h2>
              <CardDescription>{t("workshopLead")}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-5 sm:px-6">
              <div className="flex items-start gap-2.5 rounded-xl border border-[var(--color-brand)]/15 bg-[var(--color-brand-soft)]/55 p-3.5 text-sm leading-6">
                <Eye
                  aria-hidden="true"
                  className="mt-1 size-4 shrink-0 text-[var(--color-brand-strong)]"
                />
                <p>{t("visibleAfterApproval")}</p>
              </div>

              <div className="grid gap-5 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="name">
                    {t("workshopNameLabel")}
                    <RequiredCue />
                  </Label>
                  <Input
                    id="name"
                    autoComplete="organization"
                    {...register("name")}
                    required
                    aria-invalid={Boolean(errors.name)}
                    aria-describedby={describedBy(errors.name && "name-error")}
                  />
                  <FieldError id="name-error" message={errors.name?.message} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="owner_name">
                    {t("ownerNameLabel")}
                    <RequiredCue />
                  </Label>
                  <Input
                    id="owner_name"
                    autoComplete="name"
                    {...register("owner_name")}
                    required
                    aria-invalid={Boolean(errors.owner_name)}
                    aria-describedby={describedBy(errors.owner_name && "owner-name-error")}
                  />
                  <FieldError id="owner-name-error" message={errors.owner_name?.message} />
                </div>
              </div>

              <div className="grid gap-5 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="contact_phone">
                    {t("contactPhoneLabel")}
                    <RequiredCue />
                  </Label>
                  <Input
                    id="contact_phone"
                    type="tel"
                    inputMode="tel"
                    autoComplete="tel"
                    {...register("contact_phone")}
                    required
                    aria-invalid={Boolean(errors.contact_phone)}
                    aria-describedby={describedBy(
                      "contact-phone-help",
                      errors.contact_phone && "contact-phone-error",
                    )}
                  />
                  <p id="contact-phone-help" className="text-xs leading-5 text-[var(--color-muted-foreground)]">
                    {t("contactPhoneHelp")}
                  </p>
                  <FieldError id="contact-phone-error" message={errors.contact_phone?.message} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="area_id">
                    {t("areaLabel")}
                    <RequiredCue />
                  </Label>
                  <NativeSelect
                    id="area_id"
                    {...register("area_id")}
                    required
                    aria-invalid={Boolean(errors.area_id)}
                    aria-describedby={describedBy(errors.area_id && "area-error")}
                    className={invalidControlClassName}
                  >
                    <option value="">{t("chooseArea")}</option>
                    {areas.map((area) => (
                      <option key={area.id} value={area.id}>
                        {area.name}
                      </option>
                    ))}
                  </NativeSelect>
                  <FieldError id="area-error" message={errors.area_id?.message} />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="address">
                  {t("addressLabel")}
                  <RequiredCue />
                </Label>
                <Textarea
                  id="address"
                  rows={3}
                  {...register("address")}
                  required
                  placeholder={t("addressPlaceholder")}
                  aria-invalid={Boolean(errors.address)}
                  aria-describedby={describedBy(errors.address && "address-error")}
                />
                <FieldError id="address-error" message={errors.address?.message} />
              </div>

              <div className="space-y-2">
                <Label htmlFor="landmark">
                  {t("landmarkLabel")}
                  <RequiredCue />
                </Label>
                <Input
                  id="landmark"
                  {...register("landmark")}
                  required
                  placeholder={t("landmarkPlaceholder")}
                  aria-invalid={Boolean(errors.landmark)}
                  aria-describedby={describedBy("landmark-help", errors.landmark && "landmark-error")}
                />
                <p id="landmark-help" className="text-xs leading-5 text-[var(--color-muted-foreground)]">
                  {t("landmarkHelp")}
                </p>
                <FieldError id="landmark-error" message={errors.landmark?.message} />
              </div>

              {/* Public, unlike the landmark above, and said so: trainers were
                  told the landmark is only for the field officer. */}
              <div className="space-y-2">
                <Label htmlFor="directions">
                  {t("directionsLabel")} <OptionalCue />
                </Label>
                <Input
                  id="directions"
                  {...register("directions")}
                  placeholder={t("directionsPlaceholder")}
                  aria-invalid={Boolean(errors.directions)}
                  aria-describedby={describedBy(
                    "directions-help",
                    errors.directions && "directions-error",
                  )}
                />
                <p id="directions-help" className="text-xs leading-5 text-[var(--color-muted-foreground)]">
                  {t("directionsHelp")}
                </p>
                <FieldError id="directions-error" message={errors.directions?.message} />
              </div>

              {/* The master. In apprenticeship a trainee chooses the master as
                  much as the shop, and it is not always the owner. */}
              <fieldset className="grid gap-4 rounded-2xl border border-[var(--color-border)] bg-[var(--color-muted)]/30 p-4 sm:grid-cols-3 sm:p-5">
                <legend className="px-1.5 text-sm font-semibold">
                  {t("masterLegend")} <OptionalCue />
                </legend>
                <p className="text-xs leading-5 text-[var(--color-muted-foreground)] sm:col-span-3">
                  {t("masterBody")}
                </p>
                <div className="space-y-2">
                  <Label htmlFor="lead_trainer_name">{t("masterNameLabel")}</Label>
                  <Input
                    id="lead_trainer_name"
                    {...register("lead_trainer_name")}
                    placeholder={t("masterNamePlaceholder")}
                    aria-invalid={Boolean(errors.lead_trainer_name)}
                  />
                  <FieldError id="master-name-error" message={errors.lead_trainer_name?.message} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="in_trade_since">{t("inTradeSinceLabel")}</Label>
                  <Input
                    id="in_trade_since"
                    inputMode="numeric"
                    {...register("in_trade_since")}
                    placeholder="2012"
                    aria-invalid={Boolean(errors.in_trade_since)}
                  />
                  <FieldError id="in-trade-since-error" message={errors.in_trade_since?.message} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="apprentices_trained">{t("apprenticesTrainedLabel")}</Label>
                  <Input
                    id="apprentices_trained"
                    inputMode="numeric"
                    {...register("apprentices_trained")}
                    placeholder="40"
                    aria-invalid={Boolean(errors.apprentices_trained)}
                  />
                  <FieldError
                    id="apprentices-trained-error"
                    message={errors.apprentices_trained?.message}
                  />
                </div>
                <fieldset className="sm:col-span-3">
                  <legend className="text-sm font-medium">{t("teachingLanguagesLegend")}</legend>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {TEACHING_LANGUAGES.map((code) => (
                      <label
                        key={code}
                        className="flex min-h-11 cursor-pointer items-center gap-2 rounded-xl border border-[var(--color-border)] bg-[var(--color-card)] px-3 text-sm"
                      >
                        <input type="checkbox" value={code} {...register("teaching_languages")} />
                        {tLanguage(code)}
                      </label>
                    ))}
                  </div>
                </fieldset>
              </fieldset>

              <fieldset className="grid gap-4 rounded-2xl border border-[var(--color-border)] bg-[var(--color-muted)]/30 p-4 sm:grid-cols-2 sm:p-5">
                <legend className="px-1.5 text-sm font-semibold">{t("aboutWorkshop")}</legend>
                <p className="text-xs leading-5 text-[var(--color-muted-foreground)] sm:col-span-2">
                  {t("aboutWorkshopBody")}
                </p>

                <div className="space-y-2">
                  <Label htmlFor="year_established">{t("yearLabel")}</Label>
                  <Input
                    id="year_established"
                    inputMode="numeric"
                    {...register("year_established")}
                    placeholder="2016"
                    aria-invalid={Boolean(errors.year_established)}
                  />
                  <FieldError id="year-error" message={errors.year_established?.message} />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="premises_tenure">{t("premisesLabel")}</Label>
                  <NativeSelect id="premises_tenure" {...register("premises_tenure")}>
                    <option value="">{t("preferNotToSay")}</option>
                    <option value="owned">{t("premises.owned")}</option>
                    <option value="rented">{t("premises.rented")}</option>
                    <option value="shared">{t("premises.shared")}</option>
                  </NativeSelect>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="trainer_count">{t("trainerCountLabel")}</Label>
                  <Input
                    id="trainer_count"
                    inputMode="numeric"
                    {...register("trainer_count")}
                    placeholder="3"
                    aria-invalid={Boolean(errors.trainer_count)}
                  />
                  <FieldError id="trainer-count-error" message={errors.trainer_count?.message} />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="trainee_count">{t("traineeCountLabel")}</Label>
                  <Input
                    id="trainee_count"
                    inputMode="numeric"
                    {...register("trainee_count")}
                    placeholder="12"
                    aria-invalid={Boolean(errors.trainee_count)}
                  />
                  <FieldError id="trainee-count-error" message={errors.trainee_count?.message} />
                </div>
              </fieldset>

              <fieldset className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-muted)]/30 p-4 sm:p-5">
                <legend className="px-1.5 text-sm font-semibold">
                  {t("locationLegend")}
                  <RequiredCue />
                </legend>
                <p id="workshop-location-help" className="text-xs leading-5 text-[var(--color-muted-foreground)]">
                  {t("locationHelp")}
                </p>

                <div className="mt-4">
                  <LocationPickerField
                    latitude={watch("latitude")}
                    longitude={watch("longitude")}
                    areaCentroid={areaCentroid}
                    onChange={setCoordinates}
                  />
                  <p className="mt-2 text-xs text-[var(--color-muted-foreground)]">
                    {watch("latitude") && watch("longitude") ? t("dragPin") : t("tapMap")}
                  </p>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  onClick={useCurrentLocation}
                  disabled={locationState === "loading"}
                  className="mt-4 w-full sm:w-auto"
                >
                  {locationState === "loading" ? (
                    <Loader2 aria-hidden="true" className="animate-spin" />
                  ) : (
                    <LocateFixed aria-hidden="true" />
                  )}
                  {locationState === "loading" ? t("findingLocation") : t("useLocation")}
                </Button>
                {locationMessage ? (
                  <div
                    role="status"
                    className={`mt-3 flex items-center gap-2 rounded-xl border p-3 text-sm ${
                      locationState === "success"
                        ? "border-[var(--color-visit)]/20 bg-[var(--color-visit-bg)] text-[var(--color-visit)]"
                        : locationState === "error"
                          ? "border-[var(--color-warn)]/20 bg-[var(--color-warn-bg)] text-[var(--color-warn)]"
                          : "border-[var(--color-border)] bg-[var(--color-card)] text-[var(--color-muted-foreground)]"
                    }`}
                  >
                    {locationState === "success" ? (
                      <CheckCircle2 aria-hidden="true" className="size-4 shrink-0" />
                    ) : locationState === "loading" ? (
                      <Loader2 aria-hidden="true" className="size-4 shrink-0 animate-spin" />
                    ) : (
                      <AlertCircle aria-hidden="true" className="size-4 shrink-0" />
                    )}
                    <p>{locationMessage}</p>
                  </div>
                ) : null}
                <div className="mt-4">
                  <p className="flex items-center gap-1.5 text-xs font-medium text-[var(--color-muted-foreground)]">
                    <MapPin aria-hidden="true" className="size-3.5" />
                    {t("coordinatesHelp")}
                  </p>
                  <div className="mt-3 grid gap-4 sm:grid-cols-2">
                    <div className="space-y-2">
                      <Label htmlFor="latitude" className="text-xs">
                        {t("latitudeLabel")}
                        <RequiredCue />
                      </Label>
                      <Input
                        id="latitude"
                        inputMode="decimal"
                        {...register("latitude")}
                        required
                        aria-invalid={Boolean(errors.latitude)}
                        aria-describedby={describedBy(
                          "workshop-location-help",
                          errors.latitude && "latitude-error",
                        )}
                      />
                      <FieldError id="latitude-error" message={errors.latitude?.message} />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="longitude" className="text-xs">
                        {t("longitudeLabel")}
                        <RequiredCue />
                      </Label>
                      <Input
                        id="longitude"
                        inputMode="decimal"
                        {...register("longitude")}
                        required
                        aria-invalid={Boolean(errors.longitude)}
                        aria-describedby={describedBy(
                          "workshop-location-help",
                          errors.longitude && "longitude-error",
                        )}
                      />
                      <FieldError id="longitude-error" message={errors.longitude?.message} />
                    </div>
                  </div>
                </div>
              </fieldset>
            </CardContent>
            <CardFooter className="flex-col gap-3 sm:px-6">
              {error ? <FormError id="workshop-save-error" message={error} /> : null}
              <Button
                type="button"
                variant="brand"
                disabled={busy}
                onClick={() => saveThenContinue(WORKSHOP_FIELDS, "photos")}
                className="w-full"
              >
                {busy ? t("saving") : t("continueToPhotos")}
                {busy ? (
                  <Loader2 aria-hidden="true" className="animate-spin" />
                ) : (
                  <ArrowRight aria-hidden="true" />
                )}
              </Button>
            </CardFooter>
          </Card>
        </section>
      ) : null}

      {step === "photos" ? (
        <section aria-labelledby="photos-heading">
          <Card className="overflow-hidden">
            <CardHeader className="pb-4 sm:px-6 sm:pt-6">
              <div className="mb-2 grid size-11 place-items-center rounded-xl bg-[var(--color-brand-soft)] text-[var(--color-brand-strong)]">
                <Eye aria-hidden="true" className="size-5" />
              </div>
              <h2
                id="photos-heading"
                ref={stepHeadingRef}
                tabIndex={-1}
                className="text-xl font-bold tracking-tight outline-none sm:text-2xl"
              >
                {t("photosTitle")}
              </h2>
              <CardDescription>{t("photosLead")}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6 sm:px-6">
              {uploadError ? <FormError id="upload-error" message={uploadError} /> : null}

              {/* The logo first, because it is one file and optional, so it
                  does not stand between the trainer and the photographs the
                  listing actually needs. */}
              <fieldset disabled={uploading} className="space-y-3">
                <legend className="text-sm font-semibold">
                  {t("logoLegend")} <OptionalCue />
                </legend>
                <p className="text-xs leading-5 text-[var(--color-muted-foreground)]">
                  {t("logoHelp")}
                </p>

                {logoUrl ? (
                  <div className="flex items-center gap-3">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={logoUrl}
                      alt={t("logoAlt")}
                      className="size-16 rounded-xl border border-[var(--color-border)] bg-[var(--color-card)] object-contain p-1"
                    />
                    <Button type="button" variant="outline" size="sm" onClick={removeLogo}>
                      {t("removeLogo")}
                    </Button>
                  </div>
                ) : (
                  <>
                    <Label htmlFor="logo-input" className="sr-only">
                      {t("uploadLogo")}
                    </Label>
                    <Input
                      id="logo-input"
                      type="file"
                      accept="image/*"
                      onChange={(event) => {
                        const file = event.target.files?.[0];
                        event.target.value = "";
                        if (file) void setLogo(file);
                      }}
                    />
                  </>
                )}
              </fieldset>

              <Separator />

              <PhotoGroup
                kind="workshop"
                title={t("workshopPhotosTitle")}
                hint={t("workshopPhotosHint")}
                photos={photos}
                uploading={uploading}
                onAdd={addPhoto}
                onRemove={removePhoto}
              />

              <Separator />

              <PhotoGroup
                kind="work"
                title={t("workPhotosTitle")}
                hint={t("workPhotosHint")}
                photos={photos}
                uploading={uploading}
                onAdd={addPhoto}
                onAddBefore={(file, workId) => void addPhoto(file, "before", workId)}
                onRemove={removePhoto}
              />

              <Separator />

              {/* The way in, for the listing's "find the gate" card. */}
              <PhotoGroup
                kind="entrance"
                title={t("entrancePhotoTitle")}
                hint={t("entrancePhotoHint")}
                photos={photos}
                uploading={uploading}
                onAdd={addPhoto}
                onRemove={removePhoto}
                optional
                max={1}
              />

              <Separator />

              {/* The master's portrait, for the listing's portrait strip. */}
              <PhotoGroup
                kind="portrait"
                title={t("portraitPhotoTitle")}
                hint={t("portraitPhotoHint")}
                photos={photos}
                uploading={uploading}
                onAdd={addPhoto}
                onRemove={removePhoto}
                optional
                max={1}
              />

              <Separator />

              <fieldset disabled={uploading} className="space-y-3">
                <legend className="text-sm font-semibold">
                  {t("idPhotoLegend")}
                  <RequiredCue />
                </legend>
                {hasIdDocument ? (
                  <Alert>
                    <CheckCircle2 aria-hidden="true" className="size-4" />
                    <AlertDescription>
                      {t("idOnFile")}
                    </AlertDescription>
                  </Alert>
                ) : null}
                <Label htmlFor="id-input" className="sr-only">
                  {t("uploadId")}
                </Label>
                <Input
                  id="id-input"
                  type="file"
                  accept="image/*"
                  capture="environment"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    event.target.value = "";
                    if (file) void addIdDocument(file);
                  }}
                />
                <p className="flex items-start gap-1.5 text-xs leading-5 text-[var(--color-muted-foreground)]">
                  <LockKeyhole aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
                  <span>
                    {t("idPrivate")}
                  </span>
                </p>
              </fieldset>

              {uploading ? (
                <p role="status" className="flex items-center gap-2 text-sm">
                  <Loader2 aria-hidden="true" className="size-4 animate-spin" />
                  {t("uploading")}
                </p>
              ) : null}
            </CardContent>
            <CardFooter className="flex-col gap-3 sm:flex-row sm:px-6">
              <Button
                type="button"
                variant="outline"
                onClick={() => setStep("workshop")}
                className="w-full sm:w-auto"
              >
                <ArrowLeft aria-hidden="true" />
                {t("back")}
              </Button>
              <Button
                type="button"
                variant="brand"
                onClick={() => setStep("course")}
                className="w-full sm:flex-1"
              >
                {t("continueToCourse")}
                <ArrowRight aria-hidden="true" />
              </Button>
            </CardFooter>
          </Card>
        </section>
      ) : null}

      {step === "course" ? (
        <section aria-labelledby="course-heading">
          <Card className="overflow-hidden">
            <CardHeader className="pb-4 sm:px-6 sm:pt-6">
              <div className="mb-2 flex items-center justify-between gap-3">
                <div className="grid size-11 place-items-center rounded-xl bg-[var(--color-brand-soft)] text-[var(--color-brand-strong)]">
                  <BookOpen aria-hidden="true" className="size-5" />
                </div>
                <p className="text-xs text-[var(--color-muted-foreground)]">
                  <span aria-hidden="true" className="text-[var(--color-brand)]">*</span> {t("requiredFields")}
                </p>
              </div>
              <h2
                id="course-heading"
                ref={stepHeadingRef}
                tabIndex={-1}
                className="scroll-mt-24 text-xl font-bold tracking-tight outline-none"
              >
                {t("courseTitle")}
              </h2>
              <CardDescription>{t("courseLead")}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-5 sm:px-6">
              <div className="grid gap-5 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="trade_id">
                    {t("tradeLabel")}
                    <RequiredCue />
                  </Label>
                  <NativeSelect
                    id="trade_id"
                    {...register("trade_id")}
                    required
                    aria-invalid={Boolean(errors.trade_id)}
                    aria-describedby={describedBy(errors.trade_id && "trade-error")}
                    className={invalidControlClassName}
                  >
                    <option value="">{t("chooseTrade")}</option>
                    {trades.map((trade) => (
                      <option key={trade.id} value={trade.id}>
                        {trade.name}
                      </option>
                    ))}
                  </NativeSelect>
                  <FieldError id="trade-error" message={errors.trade_id?.message} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="programme_title">
                    {t("courseTitleLabel")}
                    <RequiredCue />
                  </Label>
                  <Input
                    id="programme_title"
                    {...register("programme_title")}
                    required
                    placeholder={t("courseTitlePlaceholder")}
                    aria-invalid={Boolean(errors.programme_title)}
                    aria-describedby={describedBy(errors.programme_title && "programme-title-error")}
                  />
                  <FieldError id="programme-title-error" message={errors.programme_title?.message} />
                </div>
              </div>

              <div className="grid gap-5 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="fee">
                    {t("feeLabel")}
                    <RequiredCue />
                  </Label>
                  <Input
                    id="fee"
                    inputMode="decimal"
                    {...register("fee")}
                    required
                    aria-invalid={Boolean(errors.fee)}
                    aria-describedby={describedBy(errors.fee && "fee-error")}
                  />
                  <FieldError id="fee-error" message={errors.fee?.message} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="duration_weeks">
                    {t("durationLabel")}
                    <RequiredCue />
                  </Label>
                  <Input
                    id="duration_weeks"
                    inputMode="numeric"
                    {...register("duration_weeks")}
                    required
                    aria-invalid={Boolean(errors.duration_weeks)}
                    aria-describedby={describedBy(errors.duration_weeks && "duration-error")}
                  />
                  <FieldError id="duration-error" message={errors.duration_weeks?.message} />
                </div>
              </div>

              <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-muted)]/30 p-4">
                <Label className="flex min-h-11 cursor-pointer items-center gap-3 leading-5">
                  <input
                    type="checkbox"
                    {...register("instalments_allowed")}
                    className="size-5 shrink-0 accent-[var(--color-brand)]"
                  />
                  {t("instalmentsLabel")}
                </Label>
                {instalmentsAllowed ? (
                  <div className="mt-3 space-y-2 border-t border-[var(--color-border)] pt-4">
                    <Label htmlFor="instalment_note">
                      {t("instalmentNoteLabel")}
                      <RequiredCue />
                    </Label>
                    <Input
                      id="instalment_note"
                      {...register("instalment_note")}
                      required
                      placeholder={t("instalmentNotePlaceholder")}
                      aria-invalid={Boolean(errors.instalment_note)}
                      aria-describedby={describedBy(errors.instalment_note && "instalment-note-error")}
                    />
                    <FieldError id="instalment-note-error" message={errors.instalment_note?.message} />
                  </div>
                ) : null}
              </div>

              <Separator />

              <div>
                <p className="text-sm font-semibold">{t("extraDetails")}</p>
                <p className="mt-1 text-xs leading-5 text-[var(--color-muted-foreground)]">
                  {t("extraDetailsBody")}
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="weekly_schedule" className="flex flex-wrap items-baseline gap-1.5">
                  {t("scheduleLabel")} <OptionalCue />
                </Label>
                <Input
                  id="weekly_schedule"
                  {...register("weekly_schedule")}
                  placeholder={t("schedulePlaceholder")}
                  aria-invalid={Boolean(errors.weekly_schedule)}
                  aria-describedby={describedBy(errors.weekly_schedule && "weekly-schedule-error")}
                />
                <FieldError id="weekly-schedule-error" message={errors.weekly_schedule?.message} />
              </div>

              <div className="grid gap-5 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="hours_per_week" className="flex flex-wrap items-baseline gap-1.5">
                    {t("hoursLabel")} <OptionalCue />
                  </Label>
                  <Input
                    id="hours_per_week"
                    inputMode="numeric"
                    {...register("hours_per_week")}
                    aria-invalid={Boolean(errors.hours_per_week)}
                    aria-describedby={describedBy(errors.hours_per_week && "hours-error")}
                  />
                  <FieldError id="hours-error" message={errors.hours_per_week?.message} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="capacity" className="flex flex-wrap items-baseline gap-1.5">
                    {t("capacityLabel")} <OptionalCue />
                  </Label>
                  <Input
                    id="capacity"
                    inputMode="numeric"
                    {...register("capacity")}
                    aria-invalid={Boolean(errors.capacity)}
                    aria-describedby={describedBy(errors.capacity && "capacity-error")}
                  />
                  <FieldError id="capacity-error" message={errors.capacity?.message} />
                </div>
              </div>

              <fieldset className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-muted)]/30 p-4 sm:p-5">
                <legend className="px-1.5 text-sm font-semibold">{t("feeCoversLegend")}</legend>
                <p className="text-xs leading-5 text-[var(--color-muted-foreground)]">
                  {t("feeCoversBody")}
                </p>
                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  {(
                    [
                      "fee_includes_tools",
                      "fee_includes_materials",
                      "fee_includes_ppe",
                      "fee_includes_certificate",
                    ] as const
                  ).map((field) => (
                    <label
                      key={field}
                      className="flex min-h-11 cursor-pointer items-center gap-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-card)] px-3"
                    >
                      <input type="checkbox" {...register(field)} />
                      <span className="text-sm">{t(`feeCovers.${field}`)}</span>
                    </label>
                  ))}
                </div>

                {feeIncludesCertificate ? (
                  <div className="mt-3 space-y-2">
                    <Label htmlFor="certificate_awarded">
                      {t("certificateLabel")}
                      <RequiredCue />
                    </Label>
                    <Input
                      id="certificate_awarded"
                      {...register("certificate_awarded")}
                      placeholder={t("certificatePlaceholder", {brand: BRAND})}
                      aria-invalid={Boolean(errors.certificate_awarded)}
                      aria-describedby={describedBy(
                        errors.certificate_awarded && "certificate-error",
                      )}
                    />
                    <FieldError
                      id="certificate-error"
                      message={errors.certificate_awarded?.message}
                    />
                  </div>
                ) : null}

                {/* The extras as money. Trainees see the fee, what it covers
                    and this as a receipt, with a total to plan for. */}
                <div className="mt-4 grid gap-4 sm:grid-cols-[minmax(0,10rem)_minmax(0,1fr)]">
                  <div className="space-y-2">
                    <Label htmlFor="extra_costs">
                      {t("extraCostsLabel")} <OptionalCue />
                    </Label>
                    <Input
                      id="extra_costs"
                      inputMode="decimal"
                      {...register("extra_costs")}
                      placeholder="300"
                      aria-invalid={Boolean(errors.extra_costs)}
                      aria-describedby={describedBy(
                        "extra-costs-help",
                        errors.extra_costs && "extra-costs-error",
                      )}
                    />
                    <FieldError id="extra-costs-error" message={errors.extra_costs?.message} />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="extra_costs_note">{t("extraCostsNoteLabel")}</Label>
                    <Input
                      id="extra_costs_note"
                      {...register("extra_costs_note")}
                      placeholder={t("extraCostsNotePlaceholder")}
                      aria-invalid={Boolean(errors.extra_costs_note)}
                    />
                  </div>
                  <p
                    id="extra-costs-help"
                    className="text-xs leading-5 text-[var(--color-muted-foreground)] sm:col-span-2"
                  >
                    {t("extraCostsHelp")}
                  </p>
                </div>
              </fieldset>

              <fieldset className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-muted)]/30 p-4 sm:p-5">
                <legend className="px-1.5 text-sm font-semibold">
                  {t("nextIntakeLegend")} <OptionalCue />
                </legend>
                <p id="next-intake-help" className="text-xs leading-5 text-[var(--color-muted-foreground)]">
                  {t("nextIntakeHelp")}
                </p>
                <div className="mt-4 grid gap-5 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="intake_start_date">{t("startDateLabel")}</Label>
                    <Input
                      id="intake_start_date"
                      type="date"
                      {...register("intake_start_date")}
                      aria-invalid={Boolean(errors.intake_start_date)}
                      aria-describedby={describedBy(
                        "next-intake-help",
                        errors.intake_start_date && "intake-date-error",
                      )}
                    />
                    <FieldError id="intake-date-error" message={errors.intake_start_date?.message} />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="places_offered">{t("placesOfferedLabel")}</Label>
                    <Input
                      id="places_offered"
                      inputMode="numeric"
                      {...register("places_offered")}
                      disabled={!intakeStartDate}
                      aria-invalid={Boolean(errors.places_offered)}
                      aria-describedby={describedBy(
                        "next-intake-help",
                        errors.places_offered && "places-error",
                      )}
                    />
                    <FieldError id="places-error" message={errors.places_offered?.message} />
                  </div>
                </div>
              </fieldset>
            </CardContent>
            <CardFooter className="flex-col gap-3 sm:px-6">
              {error ? <FormError id="course-save-error" message={error} /> : null}
              <div className="flex w-full flex-col-reverse gap-2 sm:flex-row sm:justify-between">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setStep("photos")}
                  className="w-full sm:w-auto"
                >
                  <ArrowLeft aria-hidden="true" />
                  {t("back")}
                </Button>
                <Button
                  type="button"
                  variant="brand"
                  disabled={busy}
                  onClick={() => saveThenContinue(COURSE_FIELDS, "review")}
                  className="w-full sm:w-auto"
                >
                  {busy ? t("saving") : t("reviewProfile")}
                  {busy ? (
                    <Loader2 aria-hidden="true" className="animate-spin" />
                  ) : (
                    <ArrowRight aria-hidden="true" />
                  )}
                </Button>
              </div>
            </CardFooter>
          </Card>
        </section>
      ) : null}

      {step === "review" ? (
        <section className="space-y-4" aria-labelledby="review-heading">
          <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-card)]/75 p-5 shadow-xs">
            <Badge variant="secondary">
              <Eye aria-hidden="true" />
              {t("readyToReview")}
            </Badge>
            <h2
              id="review-heading"
              ref={stepHeadingRef}
              tabIndex={-1}
              className="scroll-mt-24 mt-3 text-xl font-bold tracking-tight outline-none"
            >
              {t("reviewTitle")}
            </h2>
            <p className="mt-1 text-sm leading-6 text-[var(--color-muted-foreground)]">
              {t("reviewLead")}
            </p>
          </div>

          <Card>
            <CardHeader className="flex-row items-center justify-between gap-3 pb-3 sm:px-6">
              <div className="flex min-w-0 items-center gap-3">
                <div className="grid size-10 shrink-0 place-items-center rounded-xl bg-[var(--color-brand-soft)] text-[var(--color-brand-strong)]">
                  <Building2 aria-hidden="true" className="size-4" />
                </div>
                <CardTitle>{t("reviewWorkshop")}</CardTitle>
              </div>
              <Button type="button" variant="ghost" size="sm" onClick={() => setStep("workshop")}>
                <Pencil aria-hidden="true" />
                {t("edit")}
              </Button>
            </CardHeader>
            <Separator />
            <CardContent className="pt-5 sm:px-6">
              <dl className="grid gap-x-6 gap-y-4 text-sm sm:grid-cols-2">
                <div className="min-w-0">
                  <dt className="text-xs text-[var(--color-muted-foreground)]">{t("reviewName")}</dt>
                  <dd className="mt-1 break-words font-medium">{values.name}</dd>
                </div>
                <div className="min-w-0">
                  <dt className="text-xs text-[var(--color-muted-foreground)]">{t("reviewOwner")}</dt>
                  <dd className="mt-1 break-words font-medium">{values.owner_name}</dd>
                </div>
                <div className="min-w-0">
                  <dt className="text-xs text-[var(--color-muted-foreground)]">{t("reviewContact")}</dt>
                  <dd className="mt-1 break-words font-medium">{values.contact_phone}</dd>
                </div>
                <div className="min-w-0">
                  <dt className="text-xs text-[var(--color-muted-foreground)]">{t("reviewLocation")}</dt>
                  <dd className="mt-1 break-words font-medium">
                    {values.address}
                    {selectedArea ? `, ${selectedArea.name}` : ""}
                  </dd>
                </div>
              </dl>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex-row items-center justify-between gap-3 pb-3 sm:px-6">
              <div className="flex min-w-0 items-center gap-3">
                <div className="grid size-10 shrink-0 place-items-center rounded-xl bg-[var(--color-brand-soft)] text-[var(--color-brand-strong)]">
                  <BookOpen aria-hidden="true" className="size-4" />
                </div>
                <CardTitle>{t("reviewFirstCourse")}</CardTitle>
              </div>
              <Button type="button" variant="ghost" size="sm" onClick={() => setStep("course")}>
                <Pencil aria-hidden="true" />
                {t("edit")}
              </Button>
            </CardHeader>
            <Separator />
            <CardContent className="pt-5 sm:px-6">
              <dl className="grid grid-cols-1 gap-x-6 gap-y-4 text-sm sm:grid-cols-2">
                <div className="min-w-0">
                  <dt className="text-xs text-[var(--color-muted-foreground)]">{t("reviewCourse")}</dt>
                  <dd className="mt-1 break-words font-medium">{values.programme_title}</dd>
                </div>
                <div className="min-w-0">
                  <dt className="text-xs text-[var(--color-muted-foreground)]">{t("reviewTrade")}</dt>
                  <dd className="mt-1 break-words font-medium">{selectedTrade?.name}</dd>
                </div>
                <div className="min-w-0">
                  <dt className="text-xs text-[var(--color-muted-foreground)]">{t("reviewFee")}</dt>
                  <dd className="mt-1 break-words font-medium">GH₵{values.fee}</dd>
                </div>
                <div className="min-w-0">
                  <dt className="text-xs text-[var(--color-muted-foreground)]">{t("reviewDuration")}</dt>
                  <dd className="mt-1 break-words font-medium">
                    {values.duration_weeks
                      ? tFormat("weeks", {count: Number(values.duration_weeks)})
                      : null}
                  </dd>
                </div>
                <div className="min-w-0 sm:col-span-2">
                  <dt className="text-xs text-[var(--color-muted-foreground)]">{t("reviewNextIntake")}</dt>
                  <dd className="mt-1 break-words font-medium">
                    {values.intake_start_date || t("dateNotKnown")}
                  </dd>
                </div>
              </dl>
            </CardContent>
          </Card>

          {/* Three separate declarations rather than one blanket tick. Each is
              stored server-side as the moment it was made, and a trainee
              disputing a fee later is answered by "declared accurate on the
              14th", which one merged checkbox could never support. */}
          <fieldset
            disabled={busy}
            className="space-y-3 rounded-2xl border border-[var(--color-brand)]/15 bg-[var(--color-brand-soft)]/55 p-4"
          >
            <legend className="px-1.5 text-sm font-semibold">{t("beforeYouSend")}</legend>

            {(["declared_accurate", "site_visit_consent", "data_consent"] as const).map((field) => (
              <label key={field} className="flex cursor-pointer items-start gap-3 text-sm leading-6">
                <input type="checkbox" className="mt-1.5 shrink-0" {...register(field)} />
                <span>{t(`declarations.${field}`, {brand: BRAND})}</span>
              </label>
            ))}

            <p className="flex items-start gap-1.5 border-t border-[var(--color-brand)]/10 pt-3 text-xs leading-5 text-[var(--color-muted-foreground)]">
              <ShieldCheck aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
              <span>
                {t("goesPublic")}
              </span>
            </p>
          </fieldset>

          {/* What the server will refuse on, shown before the button rather
              than after it. The list comes from the same submission_blockers
              the API runs, so the two cannot disagree. */}
          {blockers.length ? (
            <div
              role="status"
              className="rounded-2xl border border-[var(--color-warn)]/25 bg-[var(--color-warn-bg)] p-4"
            >
              <p className="flex items-center gap-2 text-sm font-semibold text-[var(--color-warn)]">
                <AlertCircle aria-hidden="true" className="size-4" />
                {t("stillNeeded")}
              </p>
              <ul className="mt-2 space-y-1.5 text-sm leading-6">
                {blockers.map((item) => (
                  <li key={item} className="flex items-start gap-2">
                    <span aria-hidden="true" className="mt-2 size-1.5 shrink-0 rounded-full bg-[var(--color-warn)]" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {error ? <FormError id="profile-submit-error" message={error} /> : null}

          <div className="flex flex-col-reverse gap-2 pt-1 sm:flex-row sm:justify-between">
            <Button
              type="button"
              variant="outline"
              onClick={() => setStep("course")}
              className="w-full sm:w-auto"
            >
              <ArrowLeft aria-hidden="true" />
              {t("back")}
            </Button>
            <Button type="submit" variant="brand" disabled={busy} className="w-full sm:w-auto">
              {busy ? (
                <Loader2 aria-hidden="true" className="animate-spin" />
              ) : (
                <ShieldCheck aria-hidden="true" />
              )}
              {busy ? t("submitting") : t("submit")}
            </Button>
          </div>
        </section>
      ) : null}
    </form>
  );
}
