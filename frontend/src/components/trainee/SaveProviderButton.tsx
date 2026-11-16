"use client";

import {Bookmark, BookmarkCheck} from "lucide-react";
import Link from "next/link";
import {useTranslations} from "next-intl";
import {useEffect, useState} from "react";

import {Button} from "@/components/ui/button";
import {addRole, getAccount} from "@/lib/account-api";
import {getSavedProviders, getTraineeSession, removeSavedProvider, saveProvider} from "@/lib/trainee-api";

// "joining": signed in, but not yet as a learner. Saving makes the login a
// learner too, on the same session, instead of asking them to sign in again.
type State = "loading" | "anonymous" | "joining" | "saved" | "unsaved";

/**
 * Save a workshop to the account (the Saved tab of /account). Lives on the
 * profile page only: the search page stays free of client JavaScript.
 *
 * Signed in, it is a real button that changes at once and puts itself back
 * if the save fails. Only someone signed out is sent to sign in, and then
 * brought back here.
 */
export function SaveProviderButton({providerId, returnTo}: {providerId: number; returnTo: string}) {
  const t = useTranslations("SaveProviderButton");
  const [state, setState] = useState<State>("loading");
  const [busy, setBusy] = useState(false);
  const [readOnly, setReadOnly] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    // The one login first: whoever is signed in anywhere on the site.
    getAccount()
      .then(async (account) => {
        if (!account.authenticated) {
          if (active) setState("anonymous");
          return;
        }
        if (!account.roles.trainee) {
          if (active) setState("joining");
          return;
        }
        const [session, saved] = await Promise.all([getTraineeSession(), getSavedProviders()]);
        if (!active) return;
        setReadOnly(Boolean(session.authenticated && session.support && !session.support.can_edit));
        setState(saved.some((item) => item.provider.id === providerId) ? "saved" : "unsaved");
      })
      .catch(() => {
        if (active) setState("anonymous");
      });
    return () => {
      active = false;
    };
  }, [providerId]);

  if (state === "loading") return null;

  if (state === "anonymous") {
    return (
      <Button asChild variant="outline">
        <Link href={`/account?next=${encodeURIComponent(returnTo)}`}>
          <Bookmark aria-hidden="true" />
          {t("save")}
        </Link>
      </Button>
    );
  }

  async function toggle() {
    const before = state;
    const saving = before !== "saved";
    // Optimistic: the button changes now, the server catches up.
    setState(saving ? "saved" : "unsaved");
    setFailed(false);
    setBusy(true);
    try {
      if (saving) {
        if (before === "joining") await addRole("trainee");
        await saveProvider(providerId);
      } else {
        await removeSavedProvider(providerId);
      }
    } catch {
      setState(before);
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }

  const Icon = state === "saved" ? BookmarkCheck : Bookmark;
  return (
    <span className="inline-flex flex-col items-start gap-1">
      <Button
        type="button"
        variant={state === "saved" ? "secondary" : "outline"}
        onClick={toggle}
        disabled={busy || readOnly}
        aria-pressed={state === "saved"}
      >
        <Icon aria-hidden="true" />
        {state === "saved" ? t("saved") : t("save")}
      </Button>
      {failed ? (
        <span role="alert" className="text-xs font-medium text-[var(--color-destructive)]">
          {t("failed")}
        </span>
      ) : null}
    </span>
  );
}
