/**
 * What the app last loaded, kept on the phone, so it opens with workshops,
 * courses, products, the bag and orders even with no signal, and refreshes
 * them when the connection is back.
 *
 * Kept as one file in the app's own folder (expo-file-system), written at
 * most once a second. Search results and open chats are not kept: they are
 * only useful fresh.
 */

import type { Query } from "@tanstack/react-query";
import type { PersistedClient, Persister } from "@tanstack/react-query-persist-client";
import { File, Paths } from "expo-file-system";
import { Platform } from "react-native";

/** How long a saved answer is shown when the phone cannot get a new one. */
export const KEEP_FOR_MS = 7 * 24 * 60 * 60 * 1000;

const NOT_KEPT = new Set(["site-search", "chat", "seller-chat", "notices"]);

export function keep(query: Query): boolean {
  return query.state.status === "success" && !NOT_KEPT.has(String(query.queryKey[0]));
}

const file = () => new File(Paths.document, "saved-answers.json");

let timer: ReturnType<typeof setTimeout> | null = null;
let pending: PersistedClient | null = null;

function write() {
  timer = null;
  if (!pending) return;
  try {
    const target = file();
    if (!target.exists) target.create();
    target.write(JSON.stringify(pending));
  } catch {
    // A full phone: the app still works, it just will not open offline.
  }
  pending = null;
}

export const persister: Persister = {
  async persistClient(client) {
    if (Platform.OS === "web") return;
    pending = client;
    if (!timer) timer = setTimeout(write, 1000);
  },
  async restoreClient() {
    if (Platform.OS === "web") return undefined;
    try {
      const target = file();
      return target.exists ? (JSON.parse(await target.text()) as PersistedClient) : undefined;
    } catch {
      return undefined;
    }
  },
  async removeClient() {
    if (Platform.OS === "web") return;
    try {
      const target = file();
      if (target.exists) target.delete();
    } catch {
      // Nothing to remove.
    }
  },
};
