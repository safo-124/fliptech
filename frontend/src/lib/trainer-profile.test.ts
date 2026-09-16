import {describe, expect, it} from "vitest";

import {
  EMPTY_TRAINER_DRAFT,
  trainerDraftForStorage,
  todayIsoDate,
  trainerDraftSchema,
  trainerDraftSchemaFor,
  trainerProfilePayload,
  type TrainerDraftForm,
} from "./trainer-profile";

const complete: TrainerDraftForm = {
  ...EMPTY_TRAINER_DRAFT,
  full_name: "Ama Mensah",
  role: "owner",
  id_document_type: "ghana_card",
  id_document_number: "GHA-000111222-3",
  name: "Accra Welding Works",
  owner_name: "Ama Mensah",
  contact_phone: "0241234567",
  area_id: "7",
  address: "Opposite the community market",
  landmark: "Behind the community market",
  latitude: "5.6037",
  longitude: "-0.1870",
  trade_id: "3",
  programme_title: "Beginner arc welding",
  fee: "1200.00",
  duration_weeks: "12",
};

describe("trainer profile form", () => {
  it("builds the nested API payload and permits an unknown intake date", () => {
    expect(trainerProfilePayload(complete)).toEqual({
      full_name: "Ama Mensah",
      role: "owner",
      id_document_type: "ghana_card",
      id_document_number: "GHA-000111222-3",
      name: "Accra Welding Works",
      owner_name: "Ama Mensah",
      contact_phone: "+233241234567",
      area_id: 7,
      address: "Opposite the community market",
      landmark: "Behind the community market",
      latitude: 5.6037,
      longitude: -0.187,
      year_established: null,
      premises_tenure: "",
      trainer_count: null,
      trainee_count: null,
      declared_accurate: false,
      site_visit_consent: false,
      data_consent: false,
      programme: {
        trade_id: 3,
        title: "Beginner arc welding",
        fee: "1200.00",
        instalments_allowed: false,
        instalment_note: "",
        duration_weeks: 12,
        hours_per_week: null,
        weekly_schedule: "",
        capacity: null,
        fee_includes_tools: false,
        fee_includes_materials: false,
        fee_includes_ppe: false,
        fee_includes_certificate: false,
        certificate_awarded: "",
        intake: null,
      },
    });
  });

  it("requires the first course and an instalment explanation", () => {
    expect(trainerDraftSchema.safeParse({...complete, programme_title: ""}).success).toBe(false);
    const result = trainerDraftSchema.safeParse({...complete, instalments_allowed: true});
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues).toContainEqual(
        expect.objectContaining({path: ["instalment_note"]}),
      );
    }
  });

  it("never stores sign-in or verification secrets in the browser draft", () => {
    const unsafeDraft = {
      ...complete,
      phone: "+233240000000",
      code: "123456",
      challenge_id: "private-token",
    } as unknown as Partial<Record<keyof TrainerDraftForm, unknown>>;
    const storage = trainerDraftForStorage(unsafeDraft);

    expect(storage).toMatchObject({name: complete.name, contact_phone: complete.contact_phone});
    expect(storage).not.toHaveProperty("phone");
    expect(storage).not.toHaveProperty("code");
    expect(storage).not.toHaveProperty("challenge_id");
  });

  it("never stores the identity document in the browser draft", () => {
    // The draft persists in the browser until it is cleared, and for this
    // audience a shared or borrowed handset is realistic. An ID number left
    // in localStorage is a worse outcome than re-typing two fields after a
    // reload.
    const storage = trainerDraftForStorage(complete);

    expect(storage).not.toHaveProperty("id_document_number");
    expect(storage).not.toHaveProperty("id_document_type");
    // The rest of the step still survives a reload.
    expect(storage).toMatchObject({full_name: complete.full_name, role: complete.role});
  });

  it("keeps the landmark, which the field officer navigates by", () => {
    expect(trainerDraftSchema.safeParse({...complete, landmark: ""}).success).toBe(false);
  });

  it("wants the certificate named once the fee is said to include one", () => {
    const result = trainerDraftSchema.safeParse({
      ...complete,
      fee_includes_certificate: true,
      certificate_awarded: "",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues).toContainEqual(
        expect.objectContaining({path: ["certificate_awarded"]}),
      );
    }
  });
});

describe("intake dates", () => {
  const dated = (start: string): TrainerDraftForm => ({
    ...complete,
    intake_start_date: start,
    places_offered: "15",
  });

  const iso = (offsetDays: number) => {
    const day = new Date();
    day.setDate(day.getDate() + offsetDays);
    return todayIsoDate(day);
  };

  it("does not post places_remaining, which the API owns", () => {
    const payload = trainerProfilePayload(dated(iso(30)));
    expect(payload.programme.intake).toEqual({
      start_date: iso(30),
      places_offered: 15,
      is_open: true,
    });
    expect(payload.programme.intake).not.toHaveProperty("places_remaining");
  });

  it("rejects a start date that has already passed", () => {
    const result = trainerDraftSchemaFor().safeParse(dated(iso(-1)));
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues).toContainEqual(
        expect.objectContaining({path: ["intake_start_date"]}),
      );
    }
  });

  it("accepts the date already stored, so a returned profile can still be saved", () => {
    // The trainer waited months for the review; the date they entered then has
    // since passed. Blocking the save would leave them stuck on a step nobody
    // asked them to revisit.
    const stale = iso(-40);
    expect(trainerDraftSchemaFor(stale).safeParse(dated(stale)).success).toBe(true);
    // A different past date is still refused.
    expect(trainerDraftSchemaFor(stale).safeParse(dated(iso(-1))).success).toBe(false);
  });

  it("accepts a future date whether or not one is already stored", () => {
    expect(trainerDraftSchemaFor().safeParse(dated(iso(30))).success).toBe(true);
    expect(trainerDraftSchemaFor(iso(-40)).safeParse(dated(iso(30))).success).toBe(true);
  });
});
