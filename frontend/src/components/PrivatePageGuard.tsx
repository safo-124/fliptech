"use client";

import {useEffect} from "react";

import {isPrivatePath} from "@/lib/private-paths";
import {getWhoami} from "@/lib/session-api";

/**
 * A signed-in page brought back from the back/forward cache is a snapshot:
 * after signing out, Back could show someone's account as it was. When a
 * private page is restored that way, ask the server who is signed in, and
 * load the page afresh if nobody is (it then shows its sign-in state).
 */
export function PrivatePageGuard() {
  useEffect(() => {
    function onPageShow(event: PageTransitionEvent) {
      if (!event.persisted || !isPrivatePath(window.location.pathname)) return;
      getWhoami()
        .then((who) => {
          if (!who.customer && !who.trainer && !who.seller && !who.trainee) window.location.reload();
        })
        // Cannot tell: safer to load the page again than to show the snapshot.
        .catch(() => window.location.reload());
    }
    window.addEventListener("pageshow", onPageShow);
    return () => window.removeEventListener("pageshow", onPageShow);
  }, []);
  return null;
}
