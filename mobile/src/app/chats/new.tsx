import { useMutation, useQueryClient } from "@tanstack/react-query";
import { router, useLocalSearchParams } from "expo-router";

import { ChatView } from "@/components/ChatView";
import { requestNotificationAsk } from "@/components/NotificationAsk";
import { api, ApiError } from "@/lib/api";

/** The first message to a shop, maybe about one product. Then the chat. */
export default function NewChatScreen() {
  const { seller, name, product, productName } = useLocalSearchParams<{
    seller: string;
    name?: string;
    product?: string;
    productName?: string;
  }>();
  const client = useQueryClient();
  const start = useMutation({
    mutationFn: (body: string) => api.startChat(Number(seller), body, product ? Number(product) : undefined),
    onSuccess: (thread) => {
      requestNotificationAsk();
      client.setQueryData(["chat", String(thread.id)], thread);
      void client.invalidateQueries({ queryKey: ["chats"] });
      router.replace({ pathname: "/chats/[id]", params: { id: String(thread.id) } });
    },
  });

  return (
    <ChatView
      title={name ?? "New message"}
      messages={[]}
      loading={false}
      sending={start.isPending}
      initial={productName ? `Hello, is the ${productName} still available?` : ""}
      problem={start.error instanceof ApiError ? start.error.message : start.error ? "That did not send. Try again." : null}
      onSend={async (body) => {
        try {
          await start.mutateAsync(body);
          return true;
        } catch {
          return false;
        }
      }}
    />
  );
}
