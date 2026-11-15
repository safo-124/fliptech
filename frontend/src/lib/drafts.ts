/**
 * Form drafts kept in sessionStorage, each one belonging to one signed-in user.
 *
 * A draft survives a reload or a dropped connection, which is the point of
 * it. It must not survive a change of person: a phone or a cyber-café
 * computer is shared, and a tab that was signed in as Samuel must not open
 * the next person's form with Samuel's name in it.
 *
 * So every draft is written with the owner it was typed by, and:
 *  - a draft whose owner is not the person signed in now is never read;
 *  - signing out clears every draft (each logout helper calls clearAllDrafts);
 *  - when the header sees a different person signed in than the drafts
 *    belong to, it clears them all (claimDrafts).
 *
 * "Owner" is the user id from /api/session/whoami/, or ANONYMOUS for a
 * visitor who is not signed in.
 */

export const ANONYMOUS = "anonymous";

/** Every draft key starts with this, so all of them can be found and cleared. */
const PREFIX = "skillshub.draft.";
/** Whose drafts the ones in this tab are. */
const OWNER_KEY = "skillshub.draft-owner";
/** Keys used before drafts had owners. Never read again; cleared on sight. */
const LEGACY_KEYS = ["skillshub.trainer.public-profile-draft", "skillshub.enquiry.draft"];

export const TRAINER_PROFILE_DRAFT = "trainer-profile";
export const ENQUIRY_DRAFT = "enquiry";

type Stored<T> = {owner: string; value: T};

function storage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage;
  } catch {
    // Storage can be switched off; a form without drafts still works.
    return null;
  }
}

function key(name: string) {
  return `${PREFIX}${name}`;
}

/** The draft called `name`, if `owner` typed it. Anything else is dropped. */
export function readDraft<T>(name: string, owner: string): T | null {
  const store = storage();
  if (!store) return null;
  const raw = store.getItem(key(name));
  if (!raw) return null;
  try {
    const stored = JSON.parse(raw) as Stored<T>;
    if (stored && stored.owner === owner && stored.value && typeof stored.value === "object") {
      return stored.value;
    }
  } catch {
    // Unreadable: fall through and drop it.
  }
  store.removeItem(key(name));
  return null;
}

export function writeDraft<T>(name: string, owner: string, value: T) {
  try {
    storage()?.setItem(key(name), JSON.stringify({owner, value} satisfies Stored<T>));
  } catch {
    // Full or blocked storage: the draft is a convenience, not a requirement.
  }
}

export function removeDraft(name: string) {
  storage()?.removeItem(key(name));
}

/** Forget every draft in this tab. Called on every sign-out. */
export function clearAllDrafts() {
  const store = storage();
  if (!store) return;
  const doomed: string[] = [...LEGACY_KEYS, OWNER_KEY];
  for (let index = 0; index < store.length; index += 1) {
    const name = store.key(index);
    if (name?.startsWith(PREFIX)) doomed.push(name);
  }
  for (const name of doomed) store.removeItem(name);
}

/**
 * Record who is signed in now. If the drafts in this tab were typed by
 * someone else, they are cleared first.
 */
export function claimDrafts(owner: string) {
  const store = storage();
  if (!store) return;
  for (const legacy of LEGACY_KEYS) store.removeItem(legacy);
  const current = store.getItem(OWNER_KEY);
  if (current !== null && current !== owner) clearAllDrafts();
  store.setItem(OWNER_KEY, owner);
}

/** The owner id for a whoami response: the user id, or ANONYMOUS. */
export function ownerOf(who: {user_id?: number | null} | null | undefined): string {
  return who?.user_id ? `user-${who.user_id}` : ANONYMOUS;
}
