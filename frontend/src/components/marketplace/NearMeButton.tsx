"use client";

import { Loader2, LocateFixed } from "lucide-react";
import { useState } from "react";

/**
 * "Near me": asks the phone where it is, then reloads the marketplace sorted
 * by distance from there.
 *
 * Rounded to two decimal places (about a kilometre) before it goes into the
 * address, which is all a sort by area needs and less than a buyer's exact
 * position. Labels come as props, so this page ships no message catalogue.
 */
export function NearMeButton({
  labels,
}: {
  labels: { action: string; finding: string; refused: string };
}) {
  const [state, setState] = useState<"idle" | "finding" | "refused">("idle");

  function find() {
    if (!navigator.geolocation) {
      setState("refused");
      return;
    }
    setState("finding");
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        const url = new URL(window.location.href);
        url.searchParams.set("near", `${coords.latitude.toFixed(2)},${coords.longitude.toFixed(2)}`);
        url.searchParams.set("sort", "nearest");
        url.searchParams.delete("page");
        window.location.assign(url.toString());
      },
      () => setState("refused"),
      { enableHighAccuracy: false, timeout: 15000, maximumAge: 600000 },
    );
  }

  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <button
        type="button"
        onClick={find}
        disabled={state === "finding"}
        className="inline-flex min-h-11 items-center gap-1.5 rounded-full border border-white/30 px-4 text-sm font-semibold text-white hover:bg-white/10 disabled:opacity-70"
      >
        {state === "finding" ? (
          <Loader2 aria-hidden="true" className="size-4 animate-spin" />
        ) : (
          <LocateFixed aria-hidden="true" className="size-4" />
        )}
        {state === "finding" ? labels.finding : labels.action}
      </button>
      {state === "refused" ? (
        <span role="status" className="text-xs text-white/75">
          {labels.refused}
        </span>
      ) : null}
    </span>
  );
}
