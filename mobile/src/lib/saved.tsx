import AsyncStorage from "@react-native-async-storage/async-storage";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

import { request } from "./api";
import { useAuth } from "./auth";

const KEY = "fliiptech.saved";
const LIMIT = 50;

type Saved = {
  ids: number[];
  has: (id: number) => boolean;
  toggle: (id: number) => boolean;
};

const SavedContext = createContext<Saved | null>(null);

/**
 * Favorites: the products with a heart. Kept on the phone, and on the
 * account when signed in, so the hearts are the same on the website. On
 * sign-in this phone's list joins the account's.
 */
export function SavedProvider({ children }: { children: ReactNode }) {
  const { signedIn } = useAuth();
  const [ids, setIds] = useState<number[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    AsyncStorage.getItem(KEY)
      .then((raw) => {
        if (raw) setIds((JSON.parse(raw) as number[]).filter(Number.isInteger));
      })
      .catch(() => undefined)
      .finally(() => setLoaded(true));
  }, []);

  useEffect(() => {
    if (loaded) void AsyncStorage.setItem(KEY, JSON.stringify(ids)).catch(() => undefined);
  }, [ids, loaded]);

  useEffect(() => {
    if (!loaded || !signedIn) return;
    request<{ ids: number[] }>("PUT", "/api/account/saved/", { body: { add: ids } })
      .then((reply) => setIds(reply.ids))
      .catch(() => undefined);
    // Once per sign-in: later changes are sent one at a time by toggle.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, signedIn]);

  const has = useCallback((id: number) => ids.includes(id), [ids]);
  const toggle = useCallback(
    (id: number) => {
      const on = !ids.includes(id);
      setIds((now) => (on ? [id, ...now.filter((x) => x !== id)].slice(0, LIMIT) : now.filter((x) => x !== id)));
      if (signedIn) {
        void request("PUT", "/api/account/saved/", { body: on ? { add: [id] } : { remove: [id] } }).catch(
          () => undefined,
        );
      }
      return on;
    },
    [ids, signedIn],
  );

  const value = useMemo(() => ({ ids, has, toggle }), [ids, has, toggle]);
  return <SavedContext.Provider value={value}>{children}</SavedContext.Provider>;
}

export function useSaved(): Saved {
  const saved = useContext(SavedContext);
  if (!saved) throw new Error("useSaved outside SavedProvider");
  return saved;
}
