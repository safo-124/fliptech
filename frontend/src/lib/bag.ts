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
  return next.includes(id);
}
