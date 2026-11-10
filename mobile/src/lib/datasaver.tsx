/**
 * Data saver: smaller photos, no video that starts on its own, and lessons
 * at their smallest size. "Automatic" turns it on whenever the phone is on
 * mobile data and off on Wi-Fi. Kept on the phone.
 */

import * as Network from "expo-network";
import * as SecureStore from "expo-secure-store";
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { Platform } from "react-native";

import { setPhotoSaving } from "./media";

export type SaverMode = "auto" | "on" | "off";

const KEY = "fliiptech.data-saver";

type State = { mode: SaverMode; saving: boolean; setMode: (mode: SaverMode) => void };

const Context = createContext<State>({ mode: "auto", saving: false, setMode: () => undefined });

let current = false;

/** For code outside React (the lesson player's choice of file). */
export function dataSaving() {
  return current;
}

export function decide(mode: SaverMode, type: Network.NetworkStateType | undefined) {
  if (mode === "on") return true;
  if (mode === "off") return false;
  return type === Network.NetworkStateType.CELLULAR;
}

export function DataSaverProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<SaverMode>("auto");
  const network = Network.useNetworkState();
  const saving = decide(mode, network.type);

  useEffect(() => {
    if (Platform.OS === "web") return;
    SecureStore.getItemAsync(KEY)
      .then((stored) => {
        if (stored === "on" || stored === "off" || stored === "auto") setModeState(stored);
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    current = saving;
    setPhotoSaving(saving);
  }, [saving]);

  const value = useMemo(
    () => ({
      mode,
      saving,
      setMode(next: SaverMode) {
        setModeState(next);
        if (Platform.OS !== "web") void SecureStore.setItemAsync(KEY, next).catch(() => undefined);
      },
    }),
    [mode, saving],
  );
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useDataSaver() {
  return useContext(Context);
}
