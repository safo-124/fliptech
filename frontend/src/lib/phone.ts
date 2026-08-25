import {z} from "zod";

/** Ghana mobile numbers in either the familiar local form or E.164. */
export const ghanaPhoneSchema = z
  .string()
  .trim()
  .regex(/^(?:\+233|0)\d{9}$/, "Enter a Ghana number, like 0241234567");

export function toGhanaE164(phone: string): string {
  const normalized = phone.trim().replace(/[\s()-]/g, "");
  return normalized.startsWith("0") ? `+233${normalized.slice(1)}` : normalized;
}
