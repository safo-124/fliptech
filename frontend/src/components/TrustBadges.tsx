/**
 * Two badges, never merged.
 *
 * This component exists specifically so that the separation cannot be undone by
 * accident. One badge records the Fliiptech site visit and its date. The other
 * records government status, and it is allowed to say the status was not
 * provided. The investor proposal flags this risk twice; handling it in the
 * interface is the only place it reliably holds.
 */

import { BRAND } from "@/lib/brand";
import type { GovernmentStatusBadge, SiteVisit } from "@/lib/types";
import { formatMonthYear } from "@/lib/format";

function Badge({
  label,
  tone,
}: {
  label: string;
  tone: "visit" | "gov" | "muted";
}) {
  // Outline badges, as shadcn's are: the border carries the shape and the
  // text carries the meaning, so a row of them stays quiet until you read it.
  const tones = {
    visit: "border-[var(--color-visit)]/30 bg-[var(--color-visit-bg)] text-[var(--color-visit)]",
    gov: "border-[var(--color-gov)]/30 bg-[var(--color-gov-bg)] text-[var(--color-gov)]",
    muted: "bg-[var(--color-muted)] text-[var(--color-muted-foreground)]",
  } as const;

  return (
    <span
      className={`badge ${tones[tone]}`}
    >
      {label}
    </span>
  );
}

export function SiteVisitBadge({ visit }: { visit: SiteVisit }) {
  if (!visit) {
    // Absent is a real state and is shown, not hidden. A listing with no visit
    // must look different from one with a visit, or the visit means nothing.
    return <Badge label={`Not visited by ${BRAND}`} tone="muted" />;
  }
  return <Badge label={`${BRAND} visit ${formatMonthYear(visit.visited_on)}`} tone="visit" />;
}

export function GovernmentBadge({ status }: { status: GovernmentStatusBadge }) {
  const tone = status.registration_status === "registered" ? "gov" : "muted";
  // The label is used exactly as the backend authored it. Lowercasing it here
  // turned "Claimed, not verified by Fliiptech" into "...by fliiptech".
  return <Badge label={`CTVET: ${status.label}`} tone={tone} />;
}

export function TrustBadges({
  visit,
  government,
}: {
  visit: SiteVisit;
  government: GovernmentStatusBadge;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      <SiteVisitBadge visit={visit} />
      <GovernmentBadge status={government} />
    </div>
  );
}
