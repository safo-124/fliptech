/**
 * "Saved for later" and recently viewed, kept in this browser, and the saved
 * list on the account too while one is signed in (synced both ways).
 *
 * The basket is not here: it lives on the server (lib/basket.ts), the same
 * for the website and the app. OLD_BAGS is the key the browser-only bag
 * used to be kept under; lib/basket.ts moves anything left there into the
 * server basket once, then removes it.
 *
 * Every read and write is wrapped: storage can be switched off, full, or
 * missing in a private window, and the site must still work without it.
 */

export const OLD_BAGS = "fliiptech:bags";
const SAVED = "fliiptech:saved";
const RECENT = "fliiptech:recent";
const CHANGED = "fliiptech:bag-changed";

function read<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
    window.dispatchEvent(new Event(CHANGED));
  } catch {
    // Not kept; the page still works for this visit.
  }
}

export function onBagChange(listener: () => void) {
  window.addEventListener(CHANGED, listener);
  window.addEventListener("storage", listener);
  return () => {
    window.removeEventListener(CHANGED, listener);
    window.removeEventListener("storage", listener);
  };
}

export function savedIds(): number[] {
  return read<number[]>(SAVED, []).filter((id) => Number.isInteger(id));
}

export function toggleSaved(id: number) {
  const ids = savedIds();
  const next = ids.includes(id) ? ids.filter((x) => x !== id) : [id, ...ids].slice(0, 50);
  write(SAVED, next);
  const saved = next.includes(id);
  // Kept on the account too, when there is one signed in; refused quietly
  // when there is not, and the browser copy is enough.
  void import("./account-api")
    .then(({changeSaved}) => changeSaved(saved ? {add: [id]} : {remove: [id]}))
    .catch(() => {});
  return saved;
}

/**
 * After signing in, and on the Saved page while signed in: what this browser
 * saved goes onto the account, and what the account had comes back here, so
 * the hearts are right on every phone. True when an account took part.
 */
export async function syncSavedWithAccount(): Promise<boolean> {
  try {
    const {changeSaved} = await import("./account-api");
    const {ids} = await changeSaved({add: savedIds()});
    write(SAVED, ids);
    return true;
  } catch {
    // Signed out, or offline: the browser's list stands.
    return false;
  }
}

/**
 * On signing out: the saved list and the basket's device token leave this
 * browser. The account
 * keeps them, and they come back on signing in, but the next person to use
 * this phone should not see them, or have them added to their own account.
 */
export function forgetAccountCopies() {
  try {
    window.localStorage.removeItem(SAVED);
    window.localStorage.removeItem(OLD_BAGS);
    window.localStorage.removeItem("fliiptech:basket-token");
    window.dispatchEvent(new Event(CHANGED));
  } catch {
    // Nothing kept, so nothing to forget.
  }
}

/** Recently viewed products, newest first, on this phone only. */
export function recentIds(): number[] {
  return read<number[]>(RECENT, []).filter((id) => Number.isInteger(id));
}

export function rememberViewed(id: number) {
  try {
    const next = [id, ...recentIds().filter((x) => x !== id)].slice(0, 12);
    window.localStorage.setItem(RECENT, JSON.stringify(next));
  } catch {
    // Not kept; nothing depends on it.
  }
}
