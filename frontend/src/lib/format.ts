/** Ghana cedi and date formatting, in one place so the interface stays consistent.
 *
 * The helpers that produce words — "Fee not listed", "3 weeks", "2.4 km away" —
 * take the "Format" translator, so those words live in messages/en.json with
 * every other string. Pass `useTranslations("Format")` from a client or
 * synchronous component, or `await getTranslations("Format")` from an async
 * one. Numbers and dates stay with Intl, which already knows how to write them.
 */

import type { useTranslations } from "next-intl";

export type FormatTranslator = ReturnType<typeof useTranslations<"Format">>;

const cedi = new Intl.NumberFormat("en-GH", {
  style: "currency",
  currency: "GHS",
  maximumFractionDigits: 0,
});

const cediWithPesewas = new Intl.NumberFormat("en-GH", {
  style: "currency",
  currency: "GHS",
  minimumFractionDigits: 2,
});

/**
 * A price someone is asked to pay, from the API's "150.00": "GH₵150", or
 * "GH₵149.50" when there are pesewas. Never rounded, unlike a fee range:
 * this is the amount that leaves their wallet.
 */
export function formatCedis(value: string): string {
  const amount = Number(value);
  return (Number.isInteger(amount) ? cedi : cediWithPesewas).format(amount);
}

export function formatFee(value: string | null, t: FormatTranslator): string {
  if (value === null) return t("feeNotListed");
  return cedi.format(Number(value));
}

export function formatFeeRange(low: string | null, high: string | null, t: FormatTranslator): string {
  if (!low || !high) return t("feesNotListed");
  if (low === high) return cedi.format(Number(low));
  return t("feeRange", { low: cedi.format(Number(low)), high: cedi.format(Number(high)) });
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

export function formatDuration(weeks: number | null, t: FormatTranslator): string {
  if (weeks === null) return t("durationNotListed");
  if (weeks < 4) return t("weeks", { count: weeks });
  return t("months", { count: Math.round(weeks / 4.345) });
}

export function formatDistance(metres: number | null, t: FormatTranslator): string | null {
  if (metres === null) return null;
  if (metres < 950) return t("metresAway", { metres: Math.round(metres / 50) * 50 });
  return t("kilometresAway", { kilometres: (metres / 1000).toFixed(1) });
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

/**
 * What watching a video costs: its length in whole minutes and the data its
 * smallest copy uses, in whole MB. Null for a YouTube video, from before
 * uploads, which has neither on record. Shown before anybody taps play.
 */
export function videoCost(video: {
  kind: string;
  duration_seconds: number | null;
  sources: { bytes: number | null }[];
}): { value: number; unit: "sec" | "min"; mb: number } | null {
  const smallest = video.sources[0];
  if (video.kind === "youtube" || !video.duration_seconds || !smallest?.bytes) return null;
  return {
    ...shortLength(video.duration_seconds),
    mb: Math.max(1, Math.round(smallest.bytes / 1024 ** 2)),
  };
}

/**
 * A lesson's length for a label: seconds under a minute ("11 sec"), whole
 * minutes from there ("1 min", "2 min"). Messages say it as
 * "{value} {unit, select, sec {sec} other {min}}".
 */
export function shortLength(seconds: number): { value: number; unit: "sec" | "min" } {
  if (seconds < 60) return { value: Math.max(1, Math.round(seconds)), unit: "sec" };
  return { value: Math.round(seconds / 60), unit: "min" };
}

/** Hours to one decimal, as a number so "1 hour" / "1.5 hours" plural right. */
export function hoursOf(seconds: number) {
  return Math.round((seconds / 3600) * 10) / 10;
}

/**
 * Whether a "2026-12-01" date is today or later, in Ghana (UTC). The API only
 * sends dates from today on; this keeps a page kept across midnight from
 * showing yesterday's start date as the next one.
 */
export function notPast(isoDate: string | null | undefined, now: Date = new Date()): boolean {
  return Boolean(isoDate) && isoDate! >= now.toISOString().slice(0, 10);
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
