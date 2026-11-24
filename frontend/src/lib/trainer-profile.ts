import {z} from "zod";

import {v, type ValidationKey} from "../i18n/validation";

import {idNumberIssue, tidyIdNumber} from "./id-numbers";
import {isPlaceholder, isRoleLabel, landmarkTooShort, nameIssue} from "./placeholders";
import {ghanaPhoneSchema, toGhanaE164} from "./phone";
import type {TrainerProfile} from "./types";

// Every message below is a key into the "Validation" messages, shown in the
// visitor's language by the form. See src/i18n/validation.ts.

const requiredText = (required: ValidationKey, maximum: number) =>
  z.string().trim().min(1, v(required)).max(maximum, v("tooLong"));

/** "-5" is a number, just not one that can be a count: say so, not "whole number". */
function numberIssue(value: string): ValidationKey | null {
  if (/^\d+$/.test(value)) return null;
  return /^-\s*\d/.test(value) ? v("notNegative") : v("wholeNumber");
}

const optionalWholeNumber = z
  .string()
  .trim()
  .superRefine((value, context) => {
    const issue = value === "" ? null : numberIssue(value);
    if (issue) context.addIssue({code: "custom", message: issue});
  });

/** A whole number no larger than `maximum`, or nothing. */
const optionalWholeNumberUpTo = (maximum: number, tooMany: ValidationKey) =>
  optionalWholeNumber.refine((value) => value === "" || Number(value) <= maximum, v(tooMany));

/** A year from `earliest` to this one, or nothing. The API refuses the rest. */
const optionalPastYear = (earliest: number) =>
  optionalWholeNumber.refine(
    (value) =>
      value === "" ||
      !/^\d+$/.test(value) ||
      (Number(value) >= earliest && Number(value) <= new Date().getFullYear()),
    v("yearInvalid"),
  );

/**
 * A cedi amount as typed, made plain: "1,200", "1 200" and "GH₵1200" are all
 * 1200. Trainers write fees the way they see them written.
 */
export function plainCedis(value: string): string {
  return value
    .trim()
    .replace(/^(?:gh\s*[₵¢c]|ghs|[₵¢])\s*/i, "")
    .replace(/[\s,]/g, "");
}

const CEDIS = /^\d+(?:\.\d{1,2})?$/;

/** A cedi amount: required, or (`optional`) allowed to be empty. */
const cediAmount = (invalid: ValidationKey, optional: boolean) =>
  z
    .string()
    .trim()
    .superRefine((value, context) => {
      const plain = plainCedis(value);
      if (plain === "" ? optional : CEDIS.test(plain)) return;
      context.addIssue({
        code: "custom",
        message: /^-/.test(plain) ? v("notNegative") : v(invalid),
      });
    });

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
  // Public, unlike the landmark: see Provider.directions in the backend.
  directions: z.string().trim().max(300, v("tooLong")),
  // The master who teaches. All optional; see Provider.lead_trainer_name.
  lead_trainer_name: z.string().trim().max(120, v("tooLong")),
  in_trade_since: optionalPastYear(1940),
  apprentices_trained: optionalWholeNumber,
  teaching_languages: z.array(z.string()),
  // Ghana only, the same box as backend geography/bounds.py: a listing once
  // went live with its pin in Finland.
  latitude: coordinate(
    {required: "latitudeRequired", invalid: "latitudeInvalid", range: "latitudeRange"},
    4.5,
    11.25,
  ),
  longitude: coordinate(
    {required: "longitudeRequired", invalid: "longitudeInvalid", range: "longitudeRange"},
    -3.35,
    1.3,
  ),
  year_established: optionalPastYear(1900),
  premises_tenure: z.string(),
  trainer_count: optionalWholeNumber,
  trainee_count: optionalWholeNumber,

  // --- declarations ---
  declared_accurate: z.boolean(),
  site_visit_consent: z.boolean(),
  data_consent: z.boolean(),

  // --- the course ---
  trade_id: z.string().min(1, v("tradeRequired")),
  // "Other (describe)": the trainer's own words, when trade_id is "other".
  trade_other: z.string().max(80),
  programme_title: requiredText("courseTitleRequired", 200),
  fee: cediAmount("feeInvalid", false),
  duration_weeks: z
    .string()
    .trim()
    .superRefine((value, context) => {
      const issue = numberIssue(value);
      if (issue) {
        context.addIssue({code: "custom", message: issue === "notNegative" ? issue : v("weeksInvalid")});
      } else if (Number(value) < 1) {
        context.addIssue({code: "custom", message: v("weeksMinimum")});
      }
    }),
  instalments_allowed: z.boolean(),
  // How many payments (2 to 12) and the deposit as a per cent, from two
  // choices. "" until chosen. See Programme.instalment_count in the backend.
  instalment_count: z.string(),
  instalment_deposit_percent: z.string(),
  // When the payments after the first fall due: "weekly", "fortnightly",
  // "monthly" or "stages". See Programme.InstalmentInterval in the backend.
  instalment_interval: z.string(),
  // Only about paying in parts, what the three choices cannot say. Optional.
  instalment_note: z.string().trim().max(200, v("tooLong")),
  hours_per_week: optionalWholeNumberUpTo(168, "hoursTooMany"),
  weekly_schedule: z.string().trim().max(200, v("tooLong")),
  capacity: optionalWholeNumber,
  fee_includes_tools: z.boolean(),
  fee_includes_materials: z.boolean(),
  fee_includes_ppe: z.boolean(),
  fee_includes_certificate: z.boolean(),
  certificate_awarded: z.string().trim().max(200, v("tooLong")),
  // What a trainee spends on top of the fee. Optional: "extra" with no figure
  // is still honest, a guessed figure is not.
  extra_costs: cediAmount("amountInvalid", true),
  extra_costs_note: z.string().trim().max(200, v("tooLong")),
  intake_start_date: z.string(),
  places_offered: optionalWholeNumber,
});

type CourseRuleValues = Pick<
  z.infer<typeof trainerDraftShape>,
  | "trade_id"
  | "trade_other"
  | "places_offered"
  | "intake_start_date"
  | "fee_includes_certificate"
  | "certificate_awarded"
  | "instalments_allowed"
  | "instalment_count"
  | "instalment_interval"
  | "instalment_note"
  | "programme_title"
  | "extra_costs_note"
  | "weekly_schedule"
>;

/** Public course text that trainees read, where a stand-in ("tbc") is refused. */
const PUBLIC_COURSE_TEXT = [
  "programme_title",
  "certificate_awarded",
  "extra_costs_note",
  "instalment_note",
  "weekly_schedule",
] as const;

/** The rules between course fields, for the whole form and the course alone. */
function courseIssues(values: CourseRuleValues) {
  const issues: {path: keyof CourseRuleValues; message: ValidationKey}[] = [];
  if (values.trade_id === "other") {
    const typed = values.trade_other.trim();
    if (typed.length < 3 || !/\p{L}/u.test(typed)) {
      issues.push({path: "trade_other", message: v("tradeOtherRequired")});
    }
  }
  if (values.places_offered && !values.intake_start_date) {
    issues.push({path: "intake_start_date", message: v("startDateBeforePlaces")});
  }
  if (values.fee_includes_certificate && !values.certificate_awarded) {
    issues.push({path: "certificate_awarded", message: v("certificateRequired")});
  }
  if (values.instalments_allowed && !values.instalment_count) {
    issues.push({path: "instalment_count", message: v("instalmentCountRequired")});
  }
  if (values.instalments_allowed && !values.instalment_interval) {
    issues.push({path: "instalment_interval", message: v("instalmentIntervalRequired")});
  }
  for (const field of PUBLIC_COURSE_TEXT) {
    if (field === "instalment_note" && !values.instalments_allowed) continue;
    if (isPlaceholder(values[field])) issues.push({path: field, message: v("placeholderText")});
  }
  if (values.instalments_allowed && /^[\d\s.,%]+$/.test(values.instalment_note)) {
    // "30" on its own: 30 what? Days, cedis, per cent? Trainees cannot tell.
    issues.push({path: "instalment_note", message: v("instalmentNoteUnits")});
  }
  return issues;
}

export const trainerDraftSchema = trainerDraftShape.superRefine((values, context) => {
  // The number must have the shape of the ID type chosen (lib/id-numbers.ts).
  // Checked on the tidied number, so spaces and small letters are not errors.
  const idIssue = idNumberIssue(
    values.id_document_type,
    tidyIdNumber(values.id_document_type, values.id_document_number),
  );
  if (idIssue) context.addIssue({code: "custom", path: ["id_document_number"], message: idIssue});
  // What trainees read about the workshop: no stand-ins ("tbc"), and a name
  // box holds a name, not a role ("Owner"). The server says the same.
  for (const field of ["name", "owner_name", "lead_trainer_name", "address", "directions"] as const) {
    if (isPlaceholder(values[field])) {
      context.addIssue({code: "custom", path: [field], message: v("placeholderText")});
    } else if ((field === "owner_name" || field === "lead_trainer_name") && isRoleLabel(values[field])) {
      context.addIssue({code: "custom", path: [field], message: v("roleNotName")});
    }
  }
  for (const issue of courseIssues(values)) {
    context.addIssue({code: "custom", path: [issue.path], message: issue.message});
  }
  // Names someone can be known by, and a landmark someone can find.
  for (const field of ["name", "full_name"] as const) {
    const issue = nameIssue(values[field]);
    if (issue) {
      context.addIssue({code: "custom", path: [field], message: v(issue === "short" ? "nameTooShort" : "notAName")});
    }
  }
  if (landmarkTooShort(values.landmark)) {
    context.addIssue({code: "custom", path: ["landmark"], message: v("landmarkTwoWords")});
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
    trade_other: true,
    programme_title: true,
    fee: true,
    duration_weeks: true,
    instalments_allowed: true,
    instalment_count: true,
    instalment_deposit_percent: true,
    instalment_interval: true,
    instalment_note: true,
    hours_per_week: true,
    weekly_schedule: true,
    capacity: true,
    fee_includes_tools: true,
    fee_includes_materials: true,
    fee_includes_ppe: true,
    fee_includes_certificate: true,
    certificate_awarded: true,
    extra_costs: true,
    extra_costs_note: true,
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
  directions: "",
  lead_trainer_name: "",
  in_trade_since: "",
  apprentices_trained: "",
  teaching_languages: [],
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
  trade_other: "",
  programme_title: "",
  fee: "",
  duration_weeks: "",
  instalments_allowed: false,
  instalment_count: "",
  instalment_deposit_percent: "",
  instalment_interval: "",
  instalment_note: "",
  hours_per_week: "",
  weekly_schedule: "",
  capacity: "",
  fee_includes_tools: false,
  fee_includes_materials: false,
  fee_includes_ppe: false,
  fee_includes_certificate: false,
  certificate_awarded: "",
  extra_costs: "",
  extra_costs_note: "",
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
  // "1,000" as typed by a trainer, sent as 1000.
  const plain = plainCedis(value);
  return plain === "" ? null : Number(plain);
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
    id_document_number: tidyIdNumber(raw.id_document_type, raw.id_document_number),
    name: raw.name.trim(),
    owner_name: raw.owner_name.trim(),
    contact_phone: toGhanaE164(raw.contact_phone),
    area_id: Number(raw.area_id),
    address: raw.address.trim(),
    landmark: raw.landmark.trim(),
    directions: raw.directions.trim(),
    lead_trainer_name: raw.lead_trainer_name.trim(),
    in_trade_since: optionalNumber(raw.in_trade_since.trim()),
    apprentices_trained: optionalNumber(raw.apprentices_trained.trim()),
    teaching_languages: raw.teaching_languages,
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
    trade_id: values.trade_id === "other" ? null : Number(values.trade_id),
    trade_other: values.trade_id === "other" ? values.trade_other.trim() : "",
    title: values.programme_title,
    fee: plainCedis(values.fee),
    instalments_allowed: values.instalments_allowed,
    instalment_count: values.instalments_allowed ? optionalNumber(values.instalment_count) : null,
    instalment_deposit_percent: values.instalments_allowed
      ? optionalNumber(values.instalment_deposit_percent)
      : null,
    instalment_interval: values.instalments_allowed ? values.instalment_interval : "",
    instalment_note: values.instalments_allowed ? values.instalment_note : "",
    duration_weeks: Number(values.duration_weeks),
    hours_per_week: optionalNumber(values.hours_per_week),
    weekly_schedule: values.weekly_schedule,
    capacity: optionalNumber(values.capacity),
    fee_includes_tools: values.fee_includes_tools,
    fee_includes_materials: values.fee_includes_materials,
    fee_includes_ppe: values.fee_includes_ppe,
    fee_includes_certificate: values.fee_includes_certificate,
    certificate_awarded: values.certificate_awarded,
    extra_costs: plainCedis(values.extra_costs) || null,
    extra_costs_note: values.extra_costs_note,
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
    // ?? because a profile saved before these existed has none of them.
    directions: profile.directions ?? "",
    lead_trainer_name: profile.lead_trainer_name ?? "",
    in_trade_since:
      profile.in_trade_since === null || profile.in_trade_since === undefined
        ? ""
        : String(profile.in_trade_since),
    apprentices_trained:
      profile.apprentices_trained === null || profile.apprentices_trained === undefined
        ? ""
        : String(profile.apprentices_trained),
    teaching_languages: profile.teaching_languages ?? [],
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
    trade_id: programme.trade.slug === "other" ? "other" : String(programme.trade.id),
    trade_other: programme.trade_other ?? "",
    programme_title: programme.title,
    fee: String(programme.fee),
    duration_weeks: String(programme.duration_weeks),
    instalments_allowed: programme.instalments_allowed,
    // ?? because a profile saved before these existed has neither.
    instalment_count:
      programme.instalment_count === null || programme.instalment_count === undefined
        ? ""
        : String(programme.instalment_count),
    instalment_deposit_percent:
      programme.instalment_deposit_percent === null ||
      programme.instalment_deposit_percent === undefined
        ? ""
        : String(programme.instalment_deposit_percent),
    instalment_interval: programme.instalment_interval ?? "",
    instalment_note: programme.instalment_note,
    hours_per_week: programme.hours_per_week === null ? "" : String(programme.hours_per_week),
    weekly_schedule: programme.weekly_schedule,
    capacity: programme.capacity === null ? "" : String(programme.capacity),
    fee_includes_tools: programme.fee_includes_tools,
    fee_includes_materials: programme.fee_includes_materials,
    fee_includes_ppe: programme.fee_includes_ppe,
    fee_includes_certificate: programme.fee_includes_certificate,
    certificate_awarded: programme.certificate_awarded,
    // ?? because a profile saved before these existed has neither.
    extra_costs: programme.extra_costs ?? "",
    extra_costs_note: programme.extra_costs_note ?? "",
    intake_start_date: programme.intake?.start_date ?? "",
    places_offered:
      programme.intake?.places_offered === null || programme.intake?.places_offered === undefined
        ? ""
        : String(programme.intake.places_offered),
  };
}
