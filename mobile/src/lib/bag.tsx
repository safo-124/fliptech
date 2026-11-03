import AsyncStorage from "@react-native-async-storage/async-storage";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

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
