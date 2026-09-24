/**
 * Where the site currently has workshops, in words.
 *
 * Skills Hub is a Ghana-wide product. Greater Accra is the launch market, and
 * for a while the only one, which is why the title, the hero and the footer all
 * said "Greater Accra" as though that were the extent of it. Someone searching
 * in Kumasi read that and concluded the site was not for them.
 *
 * The fix is not to swap one hardcoded place for another. Region.is_launched
 * already models rollout — /api/regions/ returns launched regions and nothing
 * else — so the copy reads from it and follows the rollout without anyone
 * remembering to edit a string.
 */

import {getAllRegions} from "./api";
import type {Region} from "./types";

export const COUNTRY = "Ghana";

/**
 * How the live regions should be described.
 *
 * Naming them is better than "Ghana" while there are one or two: it is
 * concrete, and it sets an honest expectation for a trainee deciding whether
 * to bother. Past three the list stops being readable and the country is both
 * shorter and true.
 */
export function coveragePhrase(names: string[]): string {
  const live = names.filter((name) => name.trim());
  if (live.length === 0) return COUNTRY;
  if (live.length === 1) return live[0];
  if (live.length === 2) return `${live[0]} and ${live[1]}`;
  if (live.length === 3) return `${live[0]}, ${live[1]} and ${live[2]}`;
  return COUNTRY;
}

/**
 * The same thing for a sentence that already names the country, where
 * repeating it would read as "training in Ghana, across Ghana".
 */
export function coverageSuffix(names: string[]): string {
  const phrase = coveragePhrase(names);
  return phrase === COUNTRY ? `across ${COUNTRY}` : `in ${phrase}`;
}

/**
 * Launched region names, or an empty list.
 *
 * Never throws. This decides a line of copy on every page including the
 * footer, and a region lookup failing is not a reason to fail the page — the
 * country name is a correct answer, just a less specific one.
 */
export async function launchedRegionNames(): Promise<string[]> {
  try {
    const regions: Region[] = await getAllRegions();
    return regions.map((region) => region.name);
  } catch {
    return [];
  }
}
