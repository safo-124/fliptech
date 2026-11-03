/** "GH₵1,250" or "GH₵79.20": whole cedis without the pesewas. */
export function cedis(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === "") return "";
  const amount = Number(value);
  if (!Number.isFinite(amount)) return "";
  const whole = Number.isInteger(amount);
  return `GH₵${amount.toLocaleString("en-GH", {
    minimumFractionDigits: whole ? 0 : 2,
    maximumFractionDigits: 2,
  })}`;
}

/** "3 lessons · 12 min" or "5 lessons · 1.5 hours". */
export function courseLength(lessons: number, seconds: number | null): string {
  const count = `${lessons} ${lessons === 1 ? "lesson" : "lessons"}`;
  const total = seconds ?? 0;
  if (total >= 3600) return `${count} · ${(total / 3600).toFixed(1)} hours`;
  return `${count} · ${Math.max(1, Math.round(total / 60))} min`;
}

/** "3 Nov" or, outside this year, "3 Nov 2027". */
export function shortDate(iso: string | null | undefined): string {
  if (!iso) return "";
  const date = new Date(iso.length === 10 ? `${iso}T12:00:00` : iso);
  if (Number.isNaN(date.getTime())) return "";
  const sameYear = date.getFullYear() === new Date().getFullYear();
  return date.toLocaleDateString("en-GB", { day: "numeric", month: "short", ...(sameYear ? {} : { year: "numeric" }) });
}
