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
    name: requiredText("Workshop name", 200),
    owner_name: requiredText("Owner or trainer name", 200),
    contact_phone: ghanaPhoneSchema,
    area_id: z.string().min(1, "Choose an area"),
    address: requiredText("Workshop address", 300),
    latitude: coordinate("Latitude", -90, 90),
    longitude: coordinate("Longitude", -180, 180),
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
  name: "",
  owner_name: "",
  contact_phone: "",
  area_id: "",
  address: "",
  latitude: "",
  longitude: "",
  trade_id: "",
  programme_title: "",
  fee: "",
  duration_weeks: "",
  instalments_allowed: false,
  instalment_note: "",
  hours_per_week: "",
  weekly_schedule: "",
  capacity: "",
  intake_start_date: "",
  places_offered: "",
};

const PUBLIC_DRAFT_FIELDS = Object.keys(EMPTY_TRAINER_DRAFT) as (keyof TrainerDraftForm)[];

/**
 * Only fields destined for the public profile may survive a reload. Auth
 * phone, OTP and challenge values are deliberately absent from this allowlist.
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
    name: values.name,
    owner_name: values.owner_name,
    contact_phone: toGhanaE164(values.contact_phone),
    area_id: Number(values.area_id),
    address: values.address,
    latitude: Number(values.latitude),
    longitude: Number(values.longitude),
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

export function draftFromTrainerProfile(profile: TrainerProfile): TrainerDraftForm {
  const {programme} = profile;
  if (!programme) {
    return {
      ...EMPTY_TRAINER_DRAFT,
      name: profile.name,
      owner_name: profile.owner_name,
      contact_phone: profile.contact_phone,
      area_id: String(profile.area.id),
      address: profile.address,
      latitude: String(profile.latitude),
      longitude: String(profile.longitude),
    };
  }
  return {
    name: profile.name,
    owner_name: profile.owner_name,
    contact_phone: profile.contact_phone,
    area_id: String(profile.area.id),
    address: profile.address,
    latitude: String(profile.latitude),
    longitude: String(profile.longitude),
    trade_id: String(programme.trade.id),
    programme_title: programme.title,
    fee: String(programme.fee),
    duration_weeks: String(programme.duration_weeks),
    instalments_allowed: programme.instalments_allowed,
    instalment_note: programme.instalment_note,
    hours_per_week: programme.hours_per_week === null ? "" : String(programme.hours_per_week),
    weekly_schedule: programme.weekly_schedule,
    capacity: programme.capacity === null ? "" : String(programme.capacity),
    intake_start_date: programme.intake?.start_date ?? "",
    places_offered:
      programme.intake?.places_offered === null || programme.intake?.places_offered === undefined
        ? ""
        : String(programme.intake.places_offered),
  };
}
