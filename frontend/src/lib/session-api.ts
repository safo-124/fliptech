/**
 * Who is signed in, for the site header. Browser only.
 *
 * Separate from trainee-api and trainer-api because the header is on every
 * page and belongs to neither portal: importing either one here would pull a
 * portal's whole client into the bundle of the search page.
 */

import {trainerFetch} from "./trainer-api";
import type {Whoami} from "./types";

export function getWhoami() {
  return trainerFetch<Whoami>("/api/session/whoami/");
}
