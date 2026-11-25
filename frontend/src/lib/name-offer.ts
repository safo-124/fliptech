/**
 * The name a trainer's ID was checked under, offered as their account name.
 *
 * The account name is whatever someone typed when they signed up ("Yes",
 * "Kofi", a nickname). Once staff confirm a trainer, the name they checked
 * against the ID is known to be real, so the account page offers it, once,
 * and leaves the choice to the person: it never changes the name by itself.
 */

const DISMISSED_KEY = "fliptech:name-offer-dismissed";

function same(a: string, b: string) {
  return a.trim().replace(/\s+/g, " ").toLowerCase() === b.trim().replace(/\s+/g, " ").toLowerCase();
}

/** The name to offer, or "" when there is nothing to offer. */
export function nameToOffer(checked: string | undefined, current: string, dismissed: string | null): string {
  const name = checked?.trim() ?? "";
  if (!name || same(name, current)) return "";
  if (dismissed && same(dismissed, name)) return "";
  return name;
}

/** Which offered name this browser was told to stop offering. */
export function readDismissedName(): string | null {
  try {
    return window.localStorage.getItem(DISMISSED_KEY);
  } catch {
    return null;
  }
}

export function dismissName(name: string) {
  try {
    window.localStorage.setItem(DISMISSED_KEY, name);
  } catch {
    // Private mode or blocked storage: the offer comes back next visit.
  }
}
