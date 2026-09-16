import {Clock3, ShieldX} from "lucide-react";

import type {TrainerSession} from "@/lib/types";

/**
 * Tells a trainer whether Fliptech has confirmed their sign-up yet.
 *
 * A trainer can draft and submit while waiting, so nobody sits idle, but the
 * listing cannot go public until the sign-up is confirmed. Saying so here
 * saves a support call asking why an approved-looking profile is not live.
 */
export function TrainerAccountNotice({session}: {session: TrainerSession | null}) {
  if (!session?.authenticated || !session.account_status || session.account_status === "confirmed") {
    return null;
  }
  if (session.account_status === "declined") {
    return (
      <div role="alert" className="mb-5 flex items-start gap-3 rounded-2xl border border-[var(--color-destructive)]/30 bg-[var(--color-card)] p-4 text-sm">
        <ShieldX aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-[var(--color-destructive)]" />
        <div>
          <p className="font-semibold">Your trainer sign-up was not approved</p>
          <p className="mt-1 leading-6 text-[var(--color-muted-foreground)]">
            {session.account_note || "Contact Fliptech if you think this is a mistake."}
          </p>
        </div>
      </div>
    );
  }
  return (
    <div
      role="status"
      data-trainer-pending-confirmation
      className="mb-5 flex items-start gap-3 rounded-2xl border border-[var(--color-warn)]/25 bg-[var(--color-warn-bg)] p-4 text-sm"
    >
      <Clock3 aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-[var(--color-warn)]" />
      <div>
        <p className="font-semibold">Waiting for Fliptech to confirm your sign-up</p>
        <p className="mt-1 leading-6 text-[var(--color-muted-foreground)]">
          You can finish and submit your workshop profile now. It goes public only after your
          sign-up is confirmed and the profile is reviewed.
        </p>
      </div>
    </div>
  );
}
