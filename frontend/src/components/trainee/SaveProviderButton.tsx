"use client";

import {Bookmark, BookmarkCheck, Loader2} from "lucide-react";
import Link from "next/link";
import {useEffect, useState} from "react";

import {Button} from "@/components/ui/button";
import {getSavedProviders, getTraineeSession, removeSavedProvider, saveProvider} from "@/lib/trainee-api";

type State = "loading" | "anonymous" | "saved" | "unsaved";

/**
 * Save a workshop to the trainee's account. Lives on the profile page only:
 * the search page stays free of client JavaScript (Section 10 page weight).
 */
export function SaveProviderButton({providerId, returnTo}: {providerId: number; returnTo: string}) {
  const [state, setState] = useState<State>("loading");
  const [busy, setBusy] = useState(false);
  const [readOnly, setReadOnly] = useState(false);

  useEffect(() => {
    let active = true;
    getTraineeSession()
      .then(async (session) => {
        if (!session.authenticated) {
          if (active) setState("anonymous");
          return;
        }
        const saved = await getSavedProviders();
        if (!active) return;
        setReadOnly(Boolean(session.support && !session.support.can_edit));
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
        <Link href={`/trainee/sign-in?next=${encodeURIComponent(returnTo)}`}>
          <Bookmark aria-hidden="true" />
          Save
        </Link>
      </Button>
    );
  }

  async function toggle() {
    setBusy(true);
    try {
      if (state === "saved") {
        await removeSavedProvider(providerId);
        setState("unsaved");
      } else {
        await saveProvider(providerId);
        setState("saved");
      }
    } finally {
      setBusy(false);
    }
  }

  const Icon = busy ? Loader2 : state === "saved" ? BookmarkCheck : Bookmark;
  return (
    <Button
      type="button"
      variant={state === "saved" ? "secondary" : "outline"}
      onClick={toggle}
      disabled={busy || readOnly}
      aria-pressed={state === "saved"}
    >
      <Icon aria-hidden="true" className={busy ? "animate-spin" : undefined} />
      {state === "saved" ? "Saved" : "Save"}
    </Button>
  );
}
