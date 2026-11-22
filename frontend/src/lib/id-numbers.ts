/**
 * What an ID number has to look like, for the ID type chosen.
 *
 * The same rules as backend/providers/id_numbers.py, applied here so a mistake
 * shows at the box rather than after sending. Change both together.
 *
 * A number with the right shape is not proof the card is real: staff still
 * compare it with the photo of the card.
 */

import {v, type ValidationKey} from "../i18n/validation";

export type IdDocumentType = "ghana_card" | "passport" | "voter_id";

const SEPARATORS = /[\s\-_./–—]+/g;
// Three letters (GHA for a Ghanaian; a foreign resident's card carries their
// own country's), nine digits and one last digit.
const GHANA_CARD = /^([A-Z]{3})(\d{9})(\d)$/;
// One letter and seven digits for a Ghanaian passport; this lets a foreign one in.
const PASSPORT = /^(?=.*\d)[A-Z0-9]{6,9}$/;
const VOTER_ID = /^\d{10}$/;

/**
 * The number written the way it is stored, as far as it can be: small letters,
 * spaces and dashes are forgiven, so "gha 123456789 0" becomes
 * "GHA-123456789-0". One that does not fit its type comes back only trimmed.
 */
export function tidyIdNumber(type: string, raw: string): string {
  const value = raw.trim();
  if (!value) return "";
  let packed = value.replace(SEPARATORS, "").toUpperCase();

  if (type === "ghana_card") {
    // Ten digits on their own: the letters were left off, which are GHA.
    if (/^\d{10}$/.test(packed)) packed = `GHA${packed}`;
    const match = GHANA_CARD.exec(packed);
    return match ? `${match[1]}-${match[2]}-${match[3]}` : value;
  }
  if (type === "passport") return PASSPORT.test(packed) ? packed : value;
  if (type === "voter_id") return VOTER_ID.test(packed) ? packed : value;
  return value;
}

/** All one digit, or counting up or down: an example, not someone's card. */
function looksMadeUp(digits: string): boolean {
  return new Set(digits).size === 1 || "01234567890".includes(digits) || "9876543210".includes(digits);
}

/**
 * What is wrong with a tidied number for this ID type, as a "Validation" key,
 * or null. An empty number is the required-field check's business, not this.
 */
export function idNumberIssue(type: string, number: string): ValidationKey | null {
  if (!number) return null;
  if (!type) return v("idTypeFirst");

  if (type === "ghana_card") {
    const match = /^([A-Z]{3})-(\d{9})-(\d)$/.exec(number);
    if (!match) return v("ghanaCardNumberInvalid");
    return looksMadeUp(match[2]) ? v("idNumberLooksMadeUp") : null;
  }
  if (type === "passport") return PASSPORT.test(number) ? null : v("passportNumberInvalid");
  if (type === "voter_id") {
    if (!VOTER_ID.test(number)) return v("voterIdNumberInvalid");
    return looksMadeUp(number) ? v("idNumberLooksMadeUp") : null;
  }
  return null;
}

/** The example shown in the empty box, and the keyboard a phone opens for it. */
export const ID_NUMBER_HINTS: Record<IdDocumentType, {example: string; inputMode: "text" | "numeric"}> = {
  ghana_card: {example: "GHA-123456789-0", inputMode: "text"},
  passport: {example: "G1234567", inputMode: "text"},
  voter_id: {example: "1234567890", inputMode: "numeric"},
};

export function isIdDocumentType(value: string): value is IdDocumentType {
  return value === "ghana_card" || value === "passport" || value === "voter_id";
}
