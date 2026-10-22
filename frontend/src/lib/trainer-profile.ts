import {z} from "zod";

import {v, type ValidationKey} from "../i18n/validation";

import {ghanaPhoneSchema, toGhanaE164} from "./phone";
import type {TrainerProfile} from "./types";

// Every message below is a key into the "Validation" messages, shown in the
// visitor's language by the form. See src/i18n/validation.ts.

const requiredText = (required: ValidationKey, maximum: number) =>
  z.string().trim().min(1, v(required)).max(maximum, v("tooLong"));

const optionalWholeNumber = z
  .string()
  .trim()
  .refine((value) => value === "" || /^\d+$/.test(value), v("wholeNumber"));

const coordinate = (
  messages: {required: ValidationKey; invalid: ValidationKey; range: ValidationKey},
  minimum: number,
  maximum: number,
) =>
  z
    .string()
    .trim()
    .min(1, v(messages.required))
    .refine((value) => Number.isFinite(Number(value)), v(messages.invalid))
    .refine((value) => Number(value) >= minimum && Number(value) <= maximum, v(messages.range));

const trainerDraftShape = z.object({
  // --- who is submitting this ---
  // Required, because confirming an account is the judgement that this
  // person speaks for this workshop, and a verified phone only proves they
  // hold a SIM.
  full_name: requiredText("fullNameRequired", 200),
  role: z.string().min(1, v("roleRequired")),
  id_document_type: z.string().min(1, v("idTypeRequired")),
  id_document_number: requiredText("idNumberRequired", 60),

  // --- the workshop ---
  name: requiredText("workshopNameRequired", 200),
  owner_name: requiredText("ownerNameRequired", 200),
  contact_phone: ghanaPhoneSchema,
  area_id: z.string().min(1, v("areaRequired")),
  address: requiredText("addressRequired", 300),
  // Required. A street address does not find a workshop in Accra and a phone
  // GPS pin can be tens of metres out; the field officer navigates by this.
  landmark: requiredText("landmarkRequired", 200),
  latitude: coordinate(
    {required: "latitudeRequired", invalid: "latitudeInvalid", range: "latitudeRange"},
    -90,
    90,
  ),
  longitude: coordinate(
    {required: "longitudeRequired", invalid: "longitudeInvalid", range: "longitudeRange"},
    -180,
    180,
  ),
  year_established: optionalWholeNumber,
  premises_tenure: z.string(),
  trainer_count: optionalWholeNumber,
  trainee_count: optionalWholeNumber,

  // --- declarations ---
  declared_accurate: z.boolean(),
  site_visit_consent: z.boolean(),
  data_consent: z.boolean(),

  // --- the course ---
  trade_id: z.string().min(1, v("tradeRequired")),
  programme_title: requiredText("courseTitleRequired", 200),
  fee: z
    .string()
    .trim()
    .regex(/^\d+(?:\.\d{1,2})?$/, v("feeInvalid")),
  duration_weeks: z
    .string()
    .trim()
    .regex(/^\d+$/, v("weeksInvalid"))
    .refine((value) => Number(value) >= 1, v("weeksMinimum")),
  instalments_allowed: z.boolean(),
  instalment_note: z.string().trim().max(200, v("tooLong")),
  hours_per_week: optionalWholeNumber,
  weekly_schedule: z.string().trim().max(200, v("tooLong")),
  capacity: optionalWholeNumber,
  fee_includes_tools: z.boolean(),
  fee_includes_materials: z.boolean(),
  fee_includes_ppe: z.boolean(),
  fee_includes_certificate: z.boolean(),
  certificate_awarded: z.string().trim().max(200, v("tooLong")),
  intake_start_date: z.string(),
  places_offered: optionalWholeNumber,
});

type CourseRuleValues = Pick<
  z.infer<typeof trainerDraftShape>,
  | "places_offered"
  | "intake_start_date"
  | "fee_includes_certificate"
  | "certificate_awarded"
  | "instalments_allowed"
  | "instalment_note"
>;

/** The rules between course fields, for the whole form and the course alone. */
function courseIssues(values: CourseRuleValues) {
  const issues: {path: keyof CourseRuleValues; message: ValidationKey}[] = [];
  if (values.places_offered && !values.intake_start_date) {
    issues.push({path: "intake_start_date", message: v("startDateBeforePlaces")});
  }
  if (values.fee_includes_certificate && !values.certificate_awarded) {
    issues.push({path: "certificate_awarded", message: v("certificateRequired")});
  }
  if (values.instalments_allowed && !values.instalment_note) {
    issues.push({path: "instalment_note", message: v("instalmentNoteRequired")});
  }
  return issues;
}

export const trainerDraftSchema = trainerDraftShape.superRefine((values, context) => {
  for (const issue of courseIssues(values)) {
    context.addIssue({code: "custom", path: [issue.path], message: issue.message});
  }
});

/**
 * The course on its own, to tell whether there is one worth saving yet.
 *
 * The course step comes after the photos, and the photos need a saved
 * profile, so a new trainer's first save has no course in it.
 */
const courseSchema = trainerDraftShape
  .pick({
    trade_id: true,
    programme_title: true,
    fee: true,
    duration_weeks: true,
    instalments_allowed: true,
    instalment_note: true,
    hours_per_week: true,
    weekly_schedule: true,
    capacity: true,
    fee_includes_tools: true,
    fee_includes_materials: true,
    fee_includes_ppe: true,
    fee_includes_certificate: true,
    certificate_awarded: true,
    intake_start_date: true,
    places_offered: true,
  })
  .superRefine((values, context) => {
    for (const issue of courseIssues(values)) {
      context.addIssue({code: "custom", path: [issue.path], message: issue.message});
    }
  });

export type TrainerDraftForm = z.infer<typeof trainerDraftSchema>;

/** Today in the browser's own timezone, as the YYYY-MM-DD the input produces. */
export function todayIsoDate(now: Date = new Date()): string {
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}

/**
 * The form schema, plus the intake rule the API enforces.
 *
 * The server rejects an intake date that is not in the future, *unless* it is
 * the date already stored on this profile. That exemption matters: a trainer
 * returned for changes months after submitting would otherwise be unable to
 * save anything at all, blocked by a date that expired while they waited on
 * the review, on a step nobody asked them to revisit.
 *
 * Checking it here as well means they see it on the course step, beside the
 * field, instead of discovering it after filling in the whole wizard and
 * pressing submit. ISO dates compare correctly as strings.
 */
export function trainerDraftSchemaFor(existingIntakeStartDate?: string | null) {
  return trainerDraftSchema.superRefine((values, context) => {
    if (!values.intake_start_date) return;
    if (values.intake_start_date === existingIntakeStartDate) return;
    if (values.intake_start_date > todayIsoDate()) return;
    context.addIssue({
      code: "custom",
      path: ["intake_start_date"],
      message: v("startDateInFuture"),
    });
  });
}

export const EMPTY_TRAINER_DRAFT: TrainerDraftForm = {
  full_name: "",
  role: "",
  id_document_type: "",
  id_document_number: "",
  name: "",
  owner_name: "",
  contact_phone: "",
  area_id: "",
  address: "",
  landmark: "",
  latitude: "",
  longitude: "",
  year_established: "",
  premises_tenure: "",
  trainer_count: "",
  trainee_count: "",
  declared_accurate: false,
  site_visit_consent: false,
  data_consent: false,
  trade_id: "",
  programme_title: "",
  fee: "",
  duration_weeks: "",
  instalments_allowed: false,
  instalment_note: "",
  hours_per_week: "",
  weekly_schedule: "",
  capacity: "",
  fee_includes_tools: false,
  fee_includes_materials: false,
  fee_includes_ppe: false,
  fee_includes_certificate: false,
  certificate_awarded: "",
  intake_start_date: "",
  places_offered: "",
};

/**
 * Never written to localStorage, even though they are part of the form.
 *
 * The draft is kept so a dropped connection does not cost someone the whole
 * wizard, and it persists in the browser until it is cleared. An identity
 * document number is not something to leave sitting in localStorage on a
 * shared or borrowed handset — which, for this audience, is a realistic
 * device. Re-typing an ID number after a reload is a small price; these are
 * the last two fields on that step.
 */
const NEVER_STORED: readonly (keyof TrainerDraftForm)[] = [
  "id_document_type",
  "id_document_number",
];

const PUBLIC_DRAFT_FIELDS = (
  Object.keys(EMPTY_TRAINER_DRAFT) as (keyof TrainerDraftForm)[]
).filter((key) => !NEVER_STORED.includes(key));

/**
 * Only fields destined for the public profile may survive a reload. Auth
 * phone, OTP and challenge values are deliberately absent from this allowlist,
 * as are the identity document fields in NEVER_STORED.
 */
export function trainerDraftForStorage(
  values: Partial<Record<keyof TrainerDraftForm, unknown>>,
): Partial<TrainerDraftForm> {
  const draft: Partial<TrainerDraftForm> = {};
  for (const key of PUBLIC_DRAFT_FIELDS) {
    if (values[key] !== undefined) {
      Object.assign(draft, {[key]: values[key]});
    }
  }
  return draft;
}

function optionalNumber(value: string): number | null {
  return value === "" ? null : Number(value);
}

/**
 * The save request for what has been filled in so far.
 *
 * It refuses nothing. Each step checks its own fields before it saves and
 * the server checks the rest, so this only shapes the values. It used to
 * check the whole form, and a new trainer's first save — on the way to the
 * photos, before the course step — failed on course fields they had not
 * reached yet, without a word on screen.
 *
 * The course goes only once it is complete, and as null until then. The API
 * leaves whatever course it already has alone, and still asks for one before
 * the profile can be submitted.
 */
export function trainerProfilePayload(raw: TrainerDraftForm) {
  const course = courseSchema.safeParse(raw);

  return {
    full_name: raw.full_name.trim(),
    role: raw.role,
    id_document_type: raw.id_document_type,
    id_document_number: raw.id_document_number.trim(),
    name: raw.name.trim(),
    owner_name: raw.owner_name.trim(),
    contact_phone: toGhanaE164(raw.contact_phone),
    area_id: Number(raw.area_id),
    address: raw.address.trim(),
    landmark: raw.landmark.trim(),
    latitude: Number(raw.latitude.trim()),
    longitude: Number(raw.longitude.trim()),
    year_established: optionalNumber(raw.year_established.trim()),
    premises_tenure: raw.premises_tenure,
    trainer_count: optionalNumber(raw.trainer_count.trim()),
    trainee_count: optionalNumber(raw.trainee_count.trim()),
    declared_accurate: raw.declared_accurate,
    site_visit_consent: raw.site_visit_consent,
    data_consent: raw.data_consent,
    programme: course.success ? programmePayload(course.data) : null,
  };
}

function programmePayload(values: z.infer<typeof courseSchema>) {
  return {
    trade_id: Number(values.trade_id),
    title: values.programme_title,
    fee: values.fee,
    instalments_allowed: values.instalments_allowed,
    instalment_note: values.instalment_note,
    duration_weeks: Number(values.duration_weeks),
    hours_per_week: optionalNumber(values.hours_per_week),
    weekly_schedule: values.weekly_schedule,
    capacity: optionalNumber(values.capacity),
    fee_includes_tools: values.fee_includes_tools,
    fee_includes_materials: values.fee_includes_materials,
    fee_includes_ppe: values.fee_includes_ppe,
    fee_includes_certificate: values.fee_includes_certificate,
    certificate_awarded: values.certificate_awarded,
    // places_remaining is not sent. It is the counter that moves as trainees
    // enrol; the API seeds it from the offer when the intake is created and
    // owns it from then on. Posting it meant every edit silently reset a
    // half-full course back to empty.
    intake: values.intake_start_date
      ? {
          start_date: values.intake_start_date,
          places_offered: optionalNumber(values.places_offered),
          is_open: true,
        }
      : null,
  };
}

/** The fields that describe the workshop and the person, without the course. */
function baseDraftFrom(profile: TrainerProfile) {
  const identity = profile.identity;
  return {
    full_name: identity?.full_name ?? "",
    role: identity?.role ?? "",
    id_document_type: identity?.id_document_type ?? "",
    // Never sent back by the API and never stored locally. A trainer editing a
    // returned listing re-enters it, which is also a free second check that
    // the number matches the document already on file.
    id_document_number: "",
    name: profile.name,
    owner_name: profile.owner_name,
    contact_phone: profile.contact_phone,
    area_id: String(profile.area.id),
    address: profile.address,
    landmark: profile.landmark,
    latitude: String(profile.latitude),
    longitude: String(profile.longitude),
    year_established:
      profile.year_established === null ? "" : String(profile.year_established),
    premises_tenure: profile.premises_tenure,
    trainer_count: profile.trainer_count === null ? "" : String(profile.trainer_count),
    trainee_count: profile.trainee_count === null ? "" : String(profile.trainee_count),
    // Ticked if the declaration was already made, so someone returning to fix
    // one field is not asked to re-consent to a site visit they agreed to.
    declared_accurate: profile.declared_accurate_at !== null,
    site_visit_consent: profile.site_visit_consent_at !== null,
    data_consent: identity?.data_consent_given ?? false,
  };
}

export function draftFromTrainerProfile(profile: TrainerProfile): TrainerDraftForm {
  const {programme} = profile;
  if (!programme) {
    return {
      ...EMPTY_TRAINER_DRAFT,
      ...baseDraftFrom(profile),
    };
  }
  return {
    ...baseDraftFrom(profile),
    trade_id: String(programme.trade.id),
    programme_title: programme.title,
    fee: String(programme.fee),
    duration_weeks: String(programme.duration_weeks),
    instalments_allowed: programme.instalments_allowed,
    instalment_note: programme.instalment_note,
    hours_per_week: programme.hours_per_week === null ? "" : String(programme.hours_per_week),
    weekly_schedule: programme.weekly_schedule,
    capacity: programme.capacity === null ? "" : String(programme.capacity),
    fee_includes_tools: programme.fee_includes_tools,
    fee_includes_materials: programme.fee_includes_materials,
    fee_includes_ppe: programme.fee_includes_ppe,
    fee_includes_certificate: programme.fee_includes_certificate,
    certificate_awarded: programme.certificate_awarded,
    intake_start_date: programme.intake?.start_date ?? "",
    places_offered:
      programme.intake?.places_offered === null || programme.intake?.places_offered === undefined
        ? ""
        : String(programme.intake.places_offered),
  };
}
