/**
 * The bag and "saved for later", kept in this browser only.
 *
 * No account: a buyer here usually has none, and a bag on one phone is all
 * that is needed to buy several things from one maker in one payment. One
 * bag per seller, because one payment goes to one seller. Prices are not
 * kept here: the server prices every bag when it is shown and when it is
 * paid for, so an old price in the browser can never be charged.
 *
 * Every read and write is wrapped: storage can be switched off, full, or
 * missing in a private window, and the site must still work without it.
 */

import type {BagItem} from "./types";

const BAGS = "fliiptech:bags";
const SAVED = "fliiptech:saved";
const RECENT = "fliiptech:recent";
const CHANGED = "fliiptech:bag-changed";

export type StoredLine = BagItem & {name: string; optionLabel: string};
export type StoredBag = {sellerName: string; items: StoredLine[]};

function read<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown, fromAccount = false) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
    window.dispatchEvent(new Event(CHANGED));
  } catch {
    // Not kept; the page still works for this visit.
  }
  if (key === BAGS && !fromAccount) pushBagSoon();
}

/** Every line of every bag, as the API takes them. */
function allLines() {
  return Object.values(read<Record<string, StoredBag>>(BAGS, {})).flatMap((bag) =>
    bag.items.map((item) => ({product: item.product, option: item.option, quantity: item.quantity})),
  );
}

let pushTimer: number | undefined;

/** Keep the account's bag the same as this browser's (signed in only; a
    refusal when signed out is quiet). Debounced: a burst of taps is one save. */
function pushBagSoon() {
  if (typeof window === "undefined") return;
  window.clearTimeout(pushTimer);
  pushTimer = window.setTimeout(() => {
    void import("./account-api")
      .then(({replaceBag}) => replaceBag(allLines()))
      .catch(() => {});
  }, 800);
}

/**
 * After signing in, or on a visit while signed in: this browser's bag joins
 * the account's, and the result comes back here, so the bag is the same on
 * the phone and the website.
 */
export async function syncBagWithAccount() {
  try {
    const {addToAccountBag} = await import("./account-api");
    const {items} = await addToAccountBag(allLines());
    const bags: Record<string, StoredBag> = {};
    for (const row of items) {
      const key = String(row.seller.id);
      const bag = bags[key] ?? {sellerName: row.seller.business_name, items: []};
      bag.items.push({
        product: row.product,
        option: row.option,
        quantity: row.quantity,
        name: row.name,
        optionLabel: row.option_label,
      });
      bags[key] = bag;
    }
    write(BAGS, bags, true);
  } catch {
    // Signed out, or offline: the browser's bag stands.
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

export function allBags(): Record<string, StoredBag> {
  return read<Record<string, StoredBag>>(BAGS, {});
}

export function bagFor(sellerId: number): StoredBag | null {
  return allBags()[String(sellerId)] ?? null;
}

export function addToBag(sellerId: number, sellerName: string, line: StoredLine) {
  const bags = allBags();
  const bag = bags[String(sellerId)] ?? {sellerName, items: []};
  const same = bag.items.find((item) => item.product === line.product && item.option === line.option);
  if (same) same.quantity = Math.min(20, same.quantity + line.quantity);
  else bag.items = [...bag.items, line].slice(0, 20);
  bags[String(sellerId)] = {...bag, sellerName};
  write(BAGS, bags);
}

export function setBagLines(sellerId: number, items: StoredLine[]) {
  const bags = allBags();
  const bag = bags[String(sellerId)];
  if (!bag) return;
  if (items.length) bags[String(sellerId)] = {...bag, items};
  else delete bags[String(sellerId)];
  write(BAGS, bags);
}

export function bagCount() {
  return Object.values(allBags()).reduce(
    (sum, bag) => sum + bag.items.reduce((n, item) => n + item.quantity, 0),
    0,
  );
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
 * After signing in: what this browser saved goes onto the account, and what
 * the account had comes back here, so the hearts are right on every phone.
 */
export async function syncSavedWithAccount() {
  try {
    const {changeSaved} = await import("./account-api");
    const {ids} = await changeSaved({add: savedIds()});
    write(SAVED, ids);
  } catch {
    // Signed out, or offline: the browser's list stands.
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
