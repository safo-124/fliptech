import {z} from "zod";

import {ghanaPhoneSchema, toGhanaE164} from "./phone";
import type {TrainerProfile} from "./types";

const requiredText = (label: string, maximum: number) =>
  z.string().trim().min(1, `${label} is required`).max(maximum);

const optionalWholeNumber = z
  .string()
  .trim()
  .refine((value) => value === "" || /^\d+$/.test(value), "Enter a whole number");

const coordinate = (label: string, minimum: number, maximum: number) =>
  z
    .string()
    .trim()
    .min(1, `${label} is required`)
    .refine((value) => Number.isFinite(Number(value)), `Enter a valid ${label.toLowerCase()}`)
    .refine(
      (value) => Number(value) >= minimum && Number(value) <= maximum,
      `${label} must be between ${minimum} and ${maximum}`,
    );

export const trainerDraftSchema = z
  .object({
    // --- who is submitting this ---
    // Required, because confirming an account is the judgement that this
    // person speaks for this workshop, and a verified phone only proves they
    // hold a SIM.
    full_name: requiredText("Your name", 200),
    role: z.string().min(1, "Choose your role at the workshop"),
    id_document_type: z.string().min(1, "Choose an ID type"),
    id_document_number: requiredText("ID number", 60),

    // --- the workshop ---
    name: requiredText("Workshop name", 200),
    owner_name: requiredText("Owner or trainer name", 200),
    contact_phone: ghanaPhoneSchema,
    area_id: z.string().min(1, "Choose an area"),
    address: requiredText("Workshop address", 300),
    // Required. A street address does not find a workshop in Accra and a phone
    // GPS pin can be tens of metres out; the field officer navigates by this.
    landmark: requiredText("Nearest landmark", 200),
    latitude: coordinate("Latitude", -90, 90),
    longitude: coordinate("Longitude", -180, 180),
    year_established: optionalWholeNumber,
    premises_tenure: z.string(),
    trainer_count: optionalWholeNumber,
    trainee_count: optionalWholeNumber,

    // --- declarations ---
    declared_accurate: z.boolean(),
    site_visit_consent: z.boolean(),
    data_consent: z.boolean(),

    // --- the course ---
    trade_id: z.string().min(1, "Choose a trade"),
    programme_title: requiredText("Course title", 200),
    fee: z
      .string()
      .trim()
      .regex(/^\d+(?:\.\d{1,2})?$/, "Enter the fee in Ghana cedis"),
    duration_weeks: z
      .string()
      .trim()
      .regex(/^\d+$/, "Enter the number of weeks")
      .refine((value) => Number(value) >= 1, "Duration must be at least one week"),
    instalments_allowed: z.boolean(),
    instalment_note: z.string().trim().max(200),
    hours_per_week: optionalWholeNumber,
    weekly_schedule: z.string().trim().max(200),
    capacity: optionalWholeNumber,
    fee_includes_tools: z.boolean(),
    fee_includes_materials: z.boolean(),
    fee_includes_ppe: z.boolean(),
    fee_includes_certificate: z.boolean(),
    certificate_awarded: z.string().trim().max(200),
    intake_start_date: z.string(),
    places_offered: optionalWholeNumber,
  })
  .superRefine((values, context) => {
    if (values.places_offered && !values.intake_start_date) {
      context.addIssue({
        code: "custom",
        path: ["intake_start_date"],
        message: "Add a start date before the number of places",
      });
    }
    if (values.fee_includes_certificate && !values.certificate_awarded) {
      context.addIssue({
        code: "custom",
        path: ["certificate_awarded"],
        message: "Name the certificate the fee covers",
      });
    }
    if (values.instalments_allowed && !values.instalment_note) {
      context.addIssue({
        code: "custom",
        path: ["instalment_note"],
        message: "Explain the instalment arrangement",
      });
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
      message: "Choose a start date in the future",
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

export function trainerProfilePayload(raw: TrainerDraftForm) {
  const values = trainerDraftSchema.parse(raw);

  return {
    full_name: values.full_name,
    role: values.role,
    id_document_type: values.id_document_type,
    id_document_number: values.id_document_number,
    name: values.name,
    owner_name: values.owner_name,
    contact_phone: toGhanaE164(values.contact_phone),
    area_id: Number(values.area_id),
    address: values.address,
    landmark: values.landmark,
    latitude: Number(values.latitude),
    longitude: Number(values.longitude),
    year_established: optionalNumber(values.year_established),
    premises_tenure: values.premises_tenure,
    trainer_count: optionalNumber(values.trainer_count),
    trainee_count: optionalNumber(values.trainee_count),
    declared_accurate: values.declared_accurate,
    site_visit_consent: values.site_visit_consent,
    data_consent: values.data_consent,
    programme: {
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
    },
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
