/**
 * Who is signed in, for the site header. Browser only.
 *
 * Separate from trainee-api and trainer-api because the header is on every
 * page and belongs to neither portal: importing either one here would pull a
 * portal's whole client into the bundle of the search page.
 */

import {claimDrafts, ownerOf} from "./drafts";
import {trainerFetch} from "./trainer-fetch";
import type {Whoami} from "./types";

/**
 * Who is signed in. Every answer also settles whose form drafts this tab
 * holds: if someone else has signed in since they were typed, they are
 * cleared before any form can read them. See lib/drafts.ts.
 */
export async function getWhoami() {
  const who = await trainerFetch<Whoami>("/api/session/whoami/");
  claimDrafts(ownerOf(who));
  return who;
}

/** The draft owner for whoever is signed in now. Never throws. */
export async function currentDraftOwner(): Promise<string> {
  try {
    return ownerOf(await getWhoami());
  } catch {
    return ownerOf(null);
  }
}
