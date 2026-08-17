/** Ghana cedi and date formatting, in one place so the interface stays consistent. */

const cedi = new Intl.NumberFormat("en-GH", {
  style: "currency",
  currency: "GHS",
  maximumFractionDigits: 0,
});

export function formatFee(value: string | null): string {
  if (value === null) return "Fee not listed";
  return cedi.format(Number(value));
}

export function formatFeeRange(low: string | null, high: string | null): string {
  if (!low || !high) return "Fees not listed";
  if (low === high) return cedi.format(Number(low));
  return `${cedi.format(Number(low))} to ${cedi.format(Number(high))}`;
}

export function formatDate(value: string | null): string {
  if (!value) return "—";
  return new Date(value).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export function formatMonthYear(value: string | null): string {
  if (!value) return "—";
  return new Date(value).toLocaleDateString("en-GB", { month: "short", year: "numeric" });
}

export function formatDuration(weeks: number | null): string {
  if (weeks === null) return "Duration not listed";
  if (weeks < 4) return `${weeks} week${weeks === 1 ? "" : "s"}`;
  const months = Math.round(weeks / 4.345);
  return `${months} month${months === 1 ? "" : "s"}`;
}

export function formatDistance(metres: number | null): string | null {
  if (metres === null) return null;
  if (metres < 950) return `${Math.round(metres / 50) * 50} m away`;
  return `${(metres / 1000).toFixed(1)} km away`;
}

/**
 * Turn a URL slug into a human name: "greater-accra" -> "Greater Accra".
 *
 * CSS `capitalize` fixes the visible heading but not the <title> or the meta
 * description, which is what a search result actually shows. Those are the two
 * places this matters most, since generated pages exist to be found.
 */
export function titleCase(slug: string): string {
  return slug
    .split("-")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}
