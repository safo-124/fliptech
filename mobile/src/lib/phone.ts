/**
 * A Ghana number as the API takes it, from however it was typed:
 * "024 123 4567", "0241234567", "241234567", "+233 24 123 4567".
 * Null when it cannot be a Ghana mobile number.
 */
export function ghanaPhone(typed: string): string | null {
  const digits = typed.replace(/\D/g, "");
  let national = digits;
  if (national.startsWith("233")) national = national.slice(3);
  if (national.startsWith("0")) national = national.slice(1);
  return /^[2-5]\d{8}$/.test(national) ? `+233${national}` : null;
}

/** "+233241234567" as people say it: "024 123 4567". */
export function showPhone(e164: string) {
  const national = e164.replace(/^\+233/, "0");
  return national.length === 10 ? `${national.slice(0, 3)} ${national.slice(3, 6)} ${national.slice(6)}` : e164;
}
