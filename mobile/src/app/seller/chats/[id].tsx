import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocalSearchParams } from "expo-router";

import { ChatView } from "@/components/ChatView";
import { api, ApiError } from "@/lib/api";

/** How often an open chat asks for new messages. */
const POLL_MS = 5000;

/** One buyer's chat with the shop. Asks for new messages every few seconds while open. */
export default function SellerChatScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const client = useQueryClient();
  const thread = useQuery({
    queryKey: ["seller-chat", id],
    queryFn: () => api.sellerChat(id),
    refetchInterval: POLL_MS,
  });
  const send = useMutation({
    mutationFn: (body: string) => api.sendSellerChat(id, body),
    onSuccess: (updated) => {
      client.setQueryData(["seller-chat", id], updated);
      void client.invalidateQueries({ queryKey: ["seller-chats"] });
    },
  });

  return (
    <ChatView
      me="seller"
      title={thread.data?.with.name ?? "…"}
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
    />
  );
}
