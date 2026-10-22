import {Clock3, ShieldX} from "lucide-react";
import {useTranslations} from "next-intl";

import {BRAND} from "@/lib/brand";
import type {TrainerSession} from "@/lib/types";

/**
 * Tells a trainer whether Fliptech has confirmed their sign-up yet.
 *
 * A trainer can draft and submit while waiting, so nobody sits idle, but the
 * listing cannot go public until the sign-up is confirmed. Saying so here
 * saves a support call asking why an approved-looking profile is not live.
 */
export function TrainerAccountNotice({session}: {session: TrainerSession | null}) {
  const t = useTranslations("TrainerAccountNotice");
  if (!session?.authenticated || !session.account_status || session.account_status === "confirmed") {
    return null;
  }
  if (session.account_status === "declined") {
    return (
      <div role="alert" className="mb-5 flex items-start gap-3 rounded-2xl border border-[var(--color-destructive)]/30 bg-[var(--color-card)] p-4 text-sm">
        <ShieldX aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-[var(--color-destructive)]" />
        <div>
          <p className="font-semibold">{t("declinedTitle")}</p>
          <p className="mt-1 leading-6 text-[var(--color-muted-foreground)]">
            {session.account_note || t("declinedBody", {brand: BRAND})}
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
        <p className="font-semibold">{t("pendingTitle", {brand: BRAND})}</p>
        <p className="mt-1 leading-6 text-[var(--color-muted-foreground)]">{t("pendingBody")}</p>
      </div>
    </div>
  );
}
