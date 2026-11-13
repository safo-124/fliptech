import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocalSearchParams } from "expo-router";

import { ChatView } from "@/components/ChatView";
import { requestNotificationAsk } from "@/components/NotificationAsk";
import { api, ApiError } from "@/lib/api";

/** How often an open chat asks for new messages. */
const POLL_MS = 5000;

/** One person's chat with the shop or the workshop. Asks for new messages every few seconds while open. */
export default function InboxChatScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const client = useQueryClient();
  const thread = useQuery({
    queryKey: ["inbox-chat", id],
    queryFn: () => api.inboxChat(id),
    refetchInterval: POLL_MS,
  });
  const keep = (updated: Awaited<ReturnType<typeof api.inboxChat>>) => {
    client.setQueryData(["inbox-chat", id], updated);
    void client.invalidateQueries({ queryKey: ["inbox"] });
  };
  const send = useMutation({
    mutationFn: (body: string) => api.sendInboxChat(id, body),
    onSuccess: (updated) => {
      keep(updated);
      requestNotificationAsk();
    },
  });
  const business = thread.data?.business;

  return (
    <ChatView
      me="seller"
      title={thread.data?.with.name ?? "…"}
      kindLabel={business ? `${business.kind === "workshop" ? "WORKSHOP" : "SHOP"} · ${business.name.toUpperCase()}` : undefined}
      messages={thread.data?.messages ?? []}
      loading={thread.isPending}
      sending={send.isPending}
      problem={
        thread.error instanceof ApiError
          ? thread.error.message
          : send.error instanceof ApiError
            ? send.error.message
            : send.error
              ? "That did not send. Try again."
              : null
      }
      onSend={async (body) => {
        try {
          await send.mutateAsync(body);
          return true;
        } catch {
          return false;
        }
      }}
      onShare={async () => keep(await api.shareInboxNumber(id))}
      onReport={async (reason, details) => {
        await api.reportInboxChat(id, reason, details);
      }}
    />
  );
}
