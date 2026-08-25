import {z} from "zod";

/**
 * Ghana mobile numbers, however they were actually typed.
 *
 * People write their number the way it is printed on a shopfront: "024 123
 * 4567", "0241-234-567", sometimes with the dash a phone keyboard inserts.
 * Validating the raw string accepted only an unbroken run of digits, which is
 * the least likely form for someone to type from memory — and since this is
 * the first field in trainer sign-up, it was the first place to lose people.
 *
 * Separators are stripped before validating rather than matched against a
 * blacklist, so a pasted en dash or a non-breaking space cannot reintroduce
 * the problem. The parsed output is the stripped value, which is what should
 * be stored and sent.
 */
export function stripPhoneSeparators(phone: string): string {
  const trimmed = phone.trim();
  const plus = trimmed.startsWith("+") ? "+" : "";
  return `${plus}${trimmed.replace(/\D/g, "")}`;
}

export const ghanaPhoneSchema = z
  .string()
  .transform(stripPhoneSeparators)
  .pipe(z.string().regex(/^(?:\+233|0)\d{9}$/, "Enter a Ghana number, like 0241234567"));

export function toGhanaE164(phone: string): string {
  const normalized = stripPhoneSeparators(phone);
  return normalized.startsWith("0") ? `+233${normalized.slice(1)}` : normalized;
}
