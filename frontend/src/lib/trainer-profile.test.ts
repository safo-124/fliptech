import {describe, expect, it} from "vitest";

import {
  EMPTY_TRAINER_DRAFT,
  trainerDraftForStorage,
  trainerDraftSchema,
  trainerProfilePayload,
  type TrainerDraftForm,
} from "./trainer-profile";

const complete: TrainerDraftForm = {
  ...EMPTY_TRAINER_DRAFT,
  name: "Accra Welding Works",
  owner_name: "Ama Mensah",
  contact_phone: "0241234567",
  area_id: "7",
  address: "Opposite the community market",
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
      name: "Accra Welding Works",
      owner_name: "Ama Mensah",
      contact_phone: "+233241234567",
      area_id: 7,
      address: "Opposite the community market",
      latitude: 5.6037,
      longitude: -0.187,
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
});
