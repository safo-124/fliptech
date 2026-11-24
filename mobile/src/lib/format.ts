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

/** A lesson's length: "11 sec" under a minute, then "1 min", "2 min". */
export function shortLength(seconds: number): string {
  if (seconds < 60) return `${Math.max(1, Math.round(seconds))} sec`;
  return `${Math.round(seconds / 60)} min`;
}

/** "3 lessons · 12 min", "1 lesson · 40 sec" or "5 lessons · 1.5 hours". */
export function courseLength(lessons: number, seconds: number | null): string {
  const count = `${lessons} ${lessons === 1 ? "lesson" : "lessons"}`;
  const total = seconds ?? 0;
  if (total >= 3600) {
    const hours = Math.round((total / 3600) * 10) / 10;
    return `${count} · ${hours} ${hours === 1 ? "hour" : "hours"}`;
  }
  return `${count} · ${shortLength(total)}`;
}

/** "3 Nov" or, outside this year, "3 Nov 2027". */
export function shortDate(iso: string | null | undefined): string {
  if (!iso) return "";
  const date = new Date(iso.length === 10 ? `${iso}T12:00:00` : iso);
  if (Number.isNaN(date.getTime())) return "";
  const sameYear = date.getFullYear() === new Date().getFullYear();
  return date.toLocaleDateString("en-GB", { day: "numeric", month: "short", ...(sameYear ? {} : { year: "numeric" }) });
}

/**
 * "Zongo Junction road" + "Madina" as "Zongo Junction road, Madina", but an
 * address that already ends with its area ("Zongo Junction road, Madina")
 * is left as it is, not "…, Madina, Madina".
 */
export function withArea(address: string | null | undefined, area: string): string {
  const street = (address ?? "").trim().replace(/[\s,.]+$/, "");
  if (!street) return area;
  const tail = street.split(",").pop()?.trim().toLowerCase() ?? "";
  return tail === area.trim().toLowerCase() ? street : `${street}, ${area}`;
}
