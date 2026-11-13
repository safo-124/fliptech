import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { router, useLocalSearchParams, type Href } from "expo-router";

import { ChatView } from "@/components/ChatView";
import { requestNotificationAsk } from "@/components/NotificationAsk";
import { api, ApiError } from "@/lib/api";
import { appPath } from "@/lib/links";

/** How often an open chat asks for new messages. */
const POLL_MS = 5000;

/** One chat with a shop or a workshop. Asks for new messages every few seconds while open. */
export default function ChatScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const client = useQueryClient();
  const thread = useQuery({
    queryKey: ["chat", id],
    queryFn: () => api.chat(id),
    refetchInterval: POLL_MS,
  });
  const keep = (updated: Awaited<ReturnType<typeof api.chat>>) => {
    client.setQueryData(["chat", id], updated);
    void client.invalidateQueries({ queryKey: ["chats"] });
  };
  const send = useMutation({
    mutationFn: (body: string) => api.sendChat(id, body),
    onSuccess: (updated) => {
      keep(updated);
      requestNotificationAsk();
    },
  });
  const business = thread.data?.business;

  return (
    <ChatView
      title={thread.data?.with.name ?? "…"}
      kindLabel={business ? (business.kind === "workshop" ? "WORKSHOP" : "SHOP") : undefined}
      onOpenPage={business ? () => router.push(appPath(business.path) as Href) : undefined}
      messages={thread.data?.messages ?? []}
      loading={thread.isPending}
      sending={send.isPending}
      problem={send.error instanceof ApiError ? send.error.message : send.error ? "That did not send. Try again." : null}
      onSend={async (body) => {
        try {
          await send.mutateAsync(body);
          return true;
        } catch {
          return false;
        }
      }}
      onShare={async () => keep(await api.shareMyNumber(id))}
      onReport={async (reason, details) => {
        await api.reportChat(id, reason, details);
      }}
    />
  );
}
