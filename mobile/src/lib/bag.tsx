import AsyncStorage from "@react-native-async-storage/async-storage";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { request } from "./api";
import { useAuth } from "./auth";

/** One thing in the bag: what the API needs, and what the bag shows. */
export type BagItem = {
  product: number;
  option: number | null;
  optionLabel: string;
  quantity: number;
  name: string;
  photo: string | null;
  price: string | null;
  seller: { id: number; business_name: string };
};

const KEY = "fliiptech.bag";
/** The API takes up to 20 of one thing. */
export const MAX_QUANTITY = 20;

type Bag = {
  items: BagItem[];
  count: number;
  add: (item: BagItem) => void;
  setQuantity: (product: number, option: number | null, quantity: number) => void;
  remove: (product: number, option: number | null) => void;
  /** Empty one seller's part of the bag, once it is paid for. */
  clearSeller: (seller: number) => void;
};

const BagContext = createContext<Bag | null>(null);

const same = (item: BagItem, product: number, option: number | null) =>
  item.product === product && item.option === option;

type ServerLine = {
  product: number;
  option: number | null;
  option_label: string;
  quantity: number;
  name: string;
  price: string | null;
  photo: string | null;
  seller: { id: number; business_name: string };
};

const lines = (items: BagItem[]) =>
  items.map((item) => ({ product: item.product, option: item.option, quantity: item.quantity }));

const fromLine = (row: ServerLine): BagItem => ({
  product: row.product,
  option: row.option,
  optionLabel: row.option_label,
  quantity: row.quantity,
  name: row.name,
  photo: row.photo,
  price: row.price,
  seller: row.seller,
});

/** Add to a bag that may already hold the same thing: the numbers add up. */
export function addTo(items: BagItem[], item: BagItem): BagItem[] {
  const found = items.find((row) => same(row, item.product, item.option));
  if (!found) return [...items, { ...item, quantity: Math.min(item.quantity, MAX_QUANTITY) }];
  return items.map((row) =>
    row === found ? { ...row, quantity: Math.min(row.quantity + item.quantity, MAX_QUANTITY) } : row,
  );
}

/** The bag split by seller: each seller is paid separately. */
export function bySeller(items: BagItem[]) {
  const groups = new Map<number, { seller: BagItem["seller"]; items: BagItem[] }>();
  for (const item of items) {
    const group = groups.get(item.seller.id) ?? { seller: item.seller, items: [] };
    group.items.push(item);
    groups.set(item.seller.id, group);
  }
  return [...groups.values()];
}

/**
 * The marketplace bag, kept on the phone between visits. Like the website's,
 * it can hold things from several sellers; checkout pays one seller at a time.
 */
export function BagProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<BagItem[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    AsyncStorage.getItem(KEY)
      .then((saved) => {
        if (saved) setItems(JSON.parse(saved) as BagItem[]);
      })
      .catch(() => undefined)
      .finally(() => setLoaded(true));
  }, []);

  useEffect(() => {
    if (loaded) void AsyncStorage.setItem(KEY, JSON.stringify(items)).catch(() => undefined);
  }, [items, loaded]);

  // Signed in, the bag follows the account: on sign-in this phone's bag joins
  // the account's and the result comes back; after that each change is saved
  // there too (a burst of taps is one save).
  const { signedIn } = useAuth();
  const synced = useRef(false);
  const fromServer = useRef(false);
  useEffect(() => {
    if (!loaded || !signedIn) {
      synced.current = false;
      return;
    }
    if (synced.current) return;
    synced.current = true;
    request<{ items: ServerLine[] }>("POST", "/api/account/bag/", { body: { add: lines(items) } })
      .then((reply) => {
        fromServer.current = true;
        setItems(reply.items.map(fromLine));
      })
      .catch(() => {
        synced.current = false;
      });
    // Only when signing in or on first load, not on every change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, signedIn]);
  useEffect(() => {
    if (!loaded || !signedIn || !synced.current) return;
    if (fromServer.current) {
      fromServer.current = false;
      return;
    }
    const timer = setTimeout(() => {
      void request("PUT", "/api/account/bag/", { body: { items: lines(items) } }).catch(() => undefined);
    }, 800);
    return () => clearTimeout(timer);
  }, [items, loaded, signedIn]);

  const add = useCallback((item: BagItem) => setItems((now) => addTo(now, item)), []);
  const setQuantity = useCallback(
    (product: number, option: number | null, quantity: number) =>
      setItems((now) =>
        now.map((row) =>
          same(row, product, option) ? { ...row, quantity: Math.max(1, Math.min(quantity, MAX_QUANTITY)) } : row,
        ),
      ),
    [],
  );
  const remove = useCallback(
    (product: number, option: number | null) => setItems((now) => now.filter((row) => !same(row, product, option))),
    [],
  );
  const clearSeller = useCallback(
    (seller: number) => setItems((now) => now.filter((row) => row.seller.id !== seller)),
    [],
  );

  const value = useMemo(
    () => ({ items, count: items.reduce((sum, row) => sum + row.quantity, 0), add, setQuantity, remove, clearSeller }),
    [items, add, setQuantity, remove, clearSeller],
  );
  return <BagContext.Provider value={value}>{children}</BagContext.Provider>;
}

export function useBag(): Bag {
  const bag = useContext(BagContext);
  if (!bag) throw new Error("useBag outside BagProvider");
  return bag;
}
