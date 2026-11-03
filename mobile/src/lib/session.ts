import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

/**
 * The app's sign-in token: kept in the phone's secure storage (the Android
 * Keystore), held in memory for each request, and sent as
 * `Authorization: Bearer <token>` (backend accounts/app_auth.py).
 */
const KEY = "fliiptech.token";
let current: string | null = null;

export function token() {
  return current;
}

/** The web preview has no secure storage: there, a sign-in lasts until reload. */
const secure = Platform.OS !== "web";

export async function loadToken() {
  if (!secure) return current;
  try {
    current = await SecureStore.getItemAsync(KEY);
  } catch {
    current = null;
  }
  return current;
}

export async function saveToken(value: string | null) {
  current = value;
  if (!secure) return;
  try {
    if (value) await SecureStore.setItemAsync(KEY, value);
    else await SecureStore.deleteItemAsync(KEY);
  } catch {
    // Kept in memory for this run; the phone will ask to sign in next time.
  }
}
