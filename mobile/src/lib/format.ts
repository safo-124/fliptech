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
