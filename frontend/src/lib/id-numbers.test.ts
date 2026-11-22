import {describe, expect, it} from "vitest";

import {idNumberIssue, tidyIdNumber} from "./id-numbers";
import {EMPTY_TRAINER_DRAFT, trainerDraftSchema} from "./trainer-profile";

describe("tidyIdNumber", () => {
  it.each([
    ["ghana_card", "gha-724019385-6", "GHA-724019385-6"],
    ["ghana_card", " gha 724019385 6 ", "GHA-724019385-6"],
    ["ghana_card", "GHA7240193856", "GHA-724019385-6"],
    // The letters left off: on a Ghanaian's card they are GHA.
    ["ghana_card", "7240193856", "GHA-724019385-6"],
    ["ghana_card", "nga 724019385 6", "NGA-724019385-6"],
    ["passport", "g 123 4567", "G1234567"],
    ["voter_id", "7240 193 856", "7240193856"],
  ])("writes a %s number one way: %s", (type, typed, stored) => {
    expect(tidyIdNumber(type, typed)).toBe(stored);
    expect(idNumberIssue(type, stored)).toBeNull();
  });

  it("leaves a number that does not fit only trimmed", () => {
    expect(tidyIdNumber("ghana_card", "  abc ")).toBe("abc");
  });
});

describe("idNumberIssue", () => {
  it.each([
    ["ghana_card", "abc", "ghanaCardNumberInvalid"],
    ["ghana_card", "GHA-000000000-0", "idNumberLooksMadeUp"],
    ["ghana_card", "GHA-123456789-0", "idNumberLooksMadeUp"],
    ["passport", "ABCDEFG", "passportNumberInvalid"],
    ["voter_id", "12345", "voterIdNumberInvalid"],
    ["voter_id", "1234567890", "idNumberLooksMadeUp"],
    ["", "GHA-724019385-6", "idTypeFirst"],
  ])("refuses a %s number like %s", (type, typed, key) => {
    expect(idNumberIssue(type, tidyIdNumber(type, typed))).toBe(key);
  });

  it("follows the ID type chosen", () => {
    expect(idNumberIssue("voter_id", "7240193856")).toBeNull();
    expect(idNumberIssue("ghana_card", "7240193856")).toBe("ghanaCardNumberInvalid");
  });
});

describe("the form", () => {
  it("puts the number's problem on the number box", () => {
    const result = trainerDraftSchema.safeParse({
      ...EMPTY_TRAINER_DRAFT,
      id_document_type: "ghana_card",
      id_document_number: "abc",
    });
    expect(result.success).toBe(false);
    const issue = result.error?.issues.find((found) => found.path[0] === "id_document_number");
    expect(issue?.message).toBe("ghanaCardNumberInvalid");
  });
});
