import { useCallback, useEffect, useState } from "react";
import { AppState, Linking, Platform } from "react-native";

import { askNotificationPermission, notificationPermission } from "./notices";

const native = Platform.OS !== "web";

/**
 * Whether this phone lets Fliiptech show notifications, read again each time
 * the app comes back to the front (the person may have just changed it in
 * the phone's settings). `turnOn` asks while the phone still allows asking,
 * and opens the app's settings page once it does not.
 */
export function useNotificationPermission() {
  const [state, setState] = useState({ ready: !native, granted: !native, canAskAgain: false });

  const refresh = useCallback(async () => {
    const found = await notificationPermission();
    setState({ ready: true, ...found });
    return found;
  }, []);

  useEffect(() => {
    if (!native) return;
    let active = true;
    const read = () =>
      void notificationPermission().then((found) => {
        if (active) setState({ ready: true, ...found });
      });
    read();
    const subscription = AppState.addEventListener("change", (next) => {
      if (next === "active") read();
    });
    return () => {
      active = false;
      subscription.remove();
    };
  }, []);

  const turnOn = useCallback(async () => {
    const found = await notificationPermission();
    if (!found.granted && found.canAskAgain) await askNotificationPermission();
    else await Linking.openSettings();
    await refresh();
  }, [refresh]);

  return { ...state, refresh, turnOn };
}
