"use client";

import {BadgeCheck} from "lucide-react";
import {useTranslations} from "next-intl";
import {useState, useSyncExternalStore} from "react";

import {Button} from "@/components/ui/button";
import {updateAccount} from "@/lib/account-api";
import {dismissName, nameToOffer, readDismissedName} from "@/lib/name-offer";

const noSubscribe = () => () => {};

/**
 * "Use the name on your ID?": offered on the account page once a trainer's
 * name has been checked against their ID, so nobody types it twice. Only
 * ever an offer (see lib/name-offer).
 */
export function NameFromId({
  checkedName,
  currentName,
  onChanged,
}: {
  checkedName: string | undefined;
  currentName: string;
  onChanged: (name: string) => Promise<unknown>;
}) {
  const t = useTranslations("Account");
  // Read after hydration: the server cannot see this browser's choice.
  const stored = useSyncExternalStore(noSubscribe, readDismissedName, () => null);
  const [dismissed, setDismissed] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const name = nameToOffer(checkedName, currentName, dismissed ?? stored);
  if (!name) return null;

  return (
    <section
      aria-labelledby="name-from-id"
      className="flex flex-wrap items-start gap-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-brand-soft)] p-4"
    >
      <BadgeCheck aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-[var(--color-brand)]" />
      <div className="min-w-0 flex-1">
        <h2 id="name-from-id" className="font-semibold text-[var(--color-brand-deep)]">
          {t("idNameTitle")}
        </h2>
        <p className="mt-1 text-sm text-[var(--color-muted-foreground)]">{t("idNameBody", {name})}</p>
        {problem ? (
          <p role="alert" className="mt-2 text-sm text-[var(--color-destructive)]">
            {problem}
          </p>
        ) : null}
        <div className="mt-3 flex flex-wrap gap-2">
          <Button
            type="button"
            size="sm"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setProblem(null);
              try {
                await updateAccount({display_name: name});
                await onChanged(name);
              } catch (reason) {
                setProblem(reason instanceof Error ? reason.message : t("failed"));
              }
              setBusy(false);
            }}
          >
            {t("idNameUse")}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => {
              dismissName(name);
              setDismissed(name);
            }}
          >
            {currentName.trim() ? t("idNameKeep", {name: currentName.trim()}) : t("idNameLater")}
          </Button>
        </div>
      </div>
    </section>
  );
}
