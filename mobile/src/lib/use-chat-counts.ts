import { useQuery } from "@tanstack/react-query";

import { api } from "./api";
import { useAuth } from "./auth";
import type { ChatRole } from "./messages";

/**
 * This login's roles in chat, each with its unread and waiting counts: for
 * the count on the Me tab, the eyes on Home and the Messages screen's tabs.
 * Two numbers per role (backend UnreadView), asked for once a minute while
 * the app is open and signed in; nothing when signed out.
 */
export function useChatCounts(): ChatRole[] {
  const auth = useAuth();
  const counts = useQuery({
    queryKey: ["chat-counts"],
    queryFn: api.chatCounts,
    enabled: auth.signedIn,
    refetchInterval: 60_000,
  });
  return auth.signedIn ? (counts.data?.roles ?? []) : [];
}
