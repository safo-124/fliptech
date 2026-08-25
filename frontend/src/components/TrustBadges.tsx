/**
 * Two badges, never merged.
 *
 * This component exists specifically so that the separation cannot be undone by
 * accident. One badge records the Fliiptech site visit and its date. The other
 * records government status, and it is allowed to say the status was not
 * provided. The investor proposal flags this risk twice; handling it in the
 * interface is the only place it reliably holds.
 */

import { Landmark, Shield, ShieldCheck } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { BRAND } from "@/lib/brand";
import { formatMonthYear } from "@/lib/format";
import type { GovernmentStatusBadge, SiteVisit } from "@/lib/types";

function TrustBadge({
  kind,
  label,
  tone,
}: {
  kind: "visit" | "government";
  label: string;
  tone: "visit" | "gov" | "muted";
}) {
  const variants = {
    visit: "visit",
    gov: "government",
    muted: "secondary",
  } as const;
  const Icon = kind === "government" ? Landmark : tone === "visit" ? ShieldCheck : Shield;

  return (
    <Badge
      variant={variants[tone]}
      className="max-w-full shrink whitespace-normal text-left leading-4"
    >
      <Icon aria-hidden="true" />
      {label}
    </Badge>
  );
}

export function SiteVisitBadge({ visit }: { visit: SiteVisit }) {
  if (!visit) {
    // Absent is a real state and is shown, not hidden. A listing with no visit
    // must look different from one with a visit, or the visit means nothing.
    return <TrustBadge kind="visit" label={`Not visited by ${BRAND}`} tone="muted" />;
  }
  return (
    <TrustBadge
      kind="visit"
      label={`${BRAND} visit ${formatMonthYear(visit.visited_on)}`}
      tone="visit"
    />
  );
}

export function GovernmentBadge({ status }: { status: GovernmentStatusBadge }) {
  const tone = status.registration_status === "registered" ? "gov" : "muted";
  // The label is used exactly as the backend authored it. Lowercasing it here
  // turned "Claimed, not verified by Fliiptech" into "...by fliiptech".
  return <TrustBadge kind="government" label={`CTVET: ${status.label}`} tone={tone} />;
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
